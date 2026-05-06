const express = require("express");
const cors = require("cors");
const session = require("express-session");
const dotenv = require("dotenv");
const jsforce = require("jsforce");
const path = require("path");
const crypto = require("crypto");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const {
  PORT = 4000,
  CLIENT_URL = "http://localhost:5173",
  SESSION_SECRET = "change-me-in-production",
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  SF_REDIRECT_URI,
  SF_LOGIN_URL = "https://login.salesforce.com",
} = process.env;

const app = express();

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);

const oauth2 = new jsforce.OAuth2({
  clientId: SF_CLIENT_ID,
  clientSecret: SF_CLIENT_SECRET,
  redirectUri: SF_REDIRECT_URI,
  loginUrl: SF_LOGIN_URL,
});

function getAuthorizedConnection(req) {
  if (!req.session?.sfAuth) {
    return null;
  }

  const { instanceUrl, accessToken, refreshToken } = req.session.sfAuth;
  return new jsforce.Connection({
    oauth2,
    instanceUrl,
    accessToken,
    refreshToken,
  });
}

function ensureSalesforceAuth(req, res, next) {
  const conn = getAuthorizedConnection(req);
  if (!conn) {
    return res.status(401).json({
      error: "Not connected to Salesforce. Please log in first.",
    });
  }

  req.sfConn = conn;
  next();
}

function buildAuthUrlWithPkce(req) {
  const codeVerifier = crypto.randomBytes(64).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  req.session.oauthPkce = { codeVerifier };

  return oauth2.getAuthorizationUrl({
    scope: "api refresh_token",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
}

app.get("/auth/login-url", (req, res) => {
  const authUrl = buildAuthUrlWithPkce(req);
  req.session.save((err) => {
    if (err) {
      console.error("Failed to persist OAuth PKCE session:", err);
      return res.status(500).json({ error: "Could not initialize Salesforce login." });
    }
    res.json({ authUrl });
  });
});

app.get("/auth/login", (req, res) => {
  const authUrl = buildAuthUrlWithPkce(req);
  req.session.save((err) => {
    if (err) {
      console.error("Failed to persist OAuth PKCE session:", err);
      return res.status(500).send("Could not initialize Salesforce login.");
    }
    res.redirect(authUrl);
  });
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Missing Salesforce authorization code.");
  }

  try {
    const conn = new jsforce.Connection({ oauth2 });
    const codeVerifier = req.session?.oauthPkce?.codeVerifier;
    await conn.authorize(
      code,
      codeVerifier ? { code_verifier: codeVerifier } : undefined
    );

    req.session.sfAuth = {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      instanceUrl: conn.instanceUrl,
      userInfo: conn.userInfo,
    };
    delete req.session.oauthPkce;

    res.redirect(`${CLIENT_URL}/?connected=true`);
  } catch (error) {
    console.error("OAuth callback failed:", error);
    res.redirect(`${CLIENT_URL}/?connected=false`);
  }
});

app.get("/auth/status", (req, res) => {
  const isConnected = Boolean(req.session?.sfAuth?.accessToken);
  res.json({
    connected: isConnected,
    user: isConnected ? req.session.sfAuth.userInfo : null,
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

app.get("/api/validation-rules", ensureSalesforceAuth, async (req, res) => {
  try {
    let result;
    try {
      const primaryQuery = `
        SELECT Id, ValidationName, Active, ErrorMessage
        FROM ValidationRule
        WHERE EntityDefinition.QualifiedApiName = 'Account'
        ORDER BY ValidationName
      `;
      result = await req.sfConn.tooling.query(primaryQuery);
    } catch (primaryError) {
      const fallbackQuery = `
        SELECT Id, ValidationName, Active
        FROM ValidationRule
        WHERE EntityDefinition.QualifiedApiName = 'Account'
        ORDER BY ValidationName
      `;
      result = await req.sfConn.tooling.query(fallbackQuery);
      result._fallbackError = primaryError;
    }

    const records = (result.records || []).map((record) => ({
      Id: record.Id,
      Name: record.ValidationName,
      Active: record.Active,
      ErrorMessage: record.ErrorMessage || "No error message configured.",
    }));

    res.json({ records });
  } catch (error) {
    console.error("Failed to fetch validation rules:", error);
    res.status(500).json({
      error: "Unable to fetch validation rules from Salesforce.",
      details: error.message,
    });
  }
});

app.post("/api/validation-rules/toggle", ensureSalesforceAuth, async (req, res) => {
  const { ruleId, active } = req.body;

  if (!ruleId || typeof active !== "boolean") {
    return res.status(400).json({
      error: "ruleId and active(boolean) are required.",
    });
  }

  try {
    const updateResult = await req.sfConn.tooling.sobject("ValidationRule").update({
      Id: ruleId,
      Active: active,
    });

    if (!updateResult.success) {
      return res.status(400).json({
        error: "Salesforce rejected the update.",
        details: updateResult.errors,
      });
    }

    res.json({ success: true, id: ruleId, active });
  } catch (error) {
    console.error("Failed to update validation rule:", error);
    res.status(500).json({
      error: "Unable to update validation rule.",
      details: error.message,
    });
  }
});

app.post("/api/deploy", ensureSalesforceAuth, async (req, res) => {
  const { changes } = req.body || {};

  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({
      error: "No pending validation rule changes were provided.",
    });
  }

  const saveResults = [];

  for (const change of changes) {
    const { ruleId, active } = change || {};
    if (!ruleId || typeof active !== "boolean") {
      saveResults.push({
        ruleId: ruleId || "unknown",
        success: false,
        error: "Invalid payload. Each change needs ruleId and active(boolean).",
      });
      continue;
    }

    try {
      const existingRule = await req.sfConn.tooling
        .sobject("ValidationRule")
        .retrieve(ruleId);

      if (!existingRule?.Metadata) {
        saveResults.push({
          ruleId,
          success: false,
          error: "Could not load existing validation rule metadata.",
        });
        continue;
      }

      const updatePayload = {
        Id: ruleId,
        FullName: existingRule.FullName,
        Metadata: {
          ...existingRule.Metadata,
          active,
        },
      };

      const updateResult = await req.sfConn.tooling
        .sobject("ValidationRule")
        .update(updatePayload);

      if (!updateResult.success) {
        saveResults.push({
          ruleId,
          success: false,
          error: Array.isArray(updateResult.errors)
            ? updateResult.errors.join(", ")
            : String(updateResult.errors || "Salesforce rejected the update."),
        });
      } else {
        saveResults.push({ ruleId, success: true, active });
      }
    } catch (error) {
      saveResults.push({
        ruleId,
        success: false,
        error: error.message || "Unexpected Salesforce Tooling API failure.",
      });
    }
  }

  const failures = saveResults.filter((item) => !item.success);
  const successful = saveResults.filter((item) => item.success);
  const allSucceeded = failures.length === 0;

  res.status(allSucceeded ? 200 : 207).json({
    success: allSucceeded,
    message: allSucceeded
      ? "Deploy successful. Metadata changes have been saved to Salesforce."
      : "Deploy completed with some failed validation rule updates.",
    successfulCount: successful.length,
    failedCount: failures.length,
    results: saveResults,
    deployedAt: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
