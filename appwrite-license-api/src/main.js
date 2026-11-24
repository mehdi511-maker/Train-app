import { Client, TablesDB, Query } from "node-appwrite";
import crypto from "node:crypto";

const DATABASE_ID = "train_license_db";
const LICENSES_TABLE_ID = "licenses";
const BINDINGS_TABLE_ID = "license_bindings";

function jsonError(res, status, message) {
  return res.json(
    { success: false, message },
    status
  );
}

function hashValue(value, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    .update(value, "utf8")
    .digest("hex");
}

export default async ({ req, res, log, error }) => {
  try {
    const endpoint =
      process.env.APPWRITE_FUNCTION_API_ENDPOINT;

    const projectId =
      process.env.APPWRITE_FUNCTION_PROJECT_ID;

    const apiKey =
      process.env.APPWRITE_API_KEY;

    const pepper =
      process.env.CODE_PEPPER;

    if (!endpoint || !projectId || !apiKey || !pepper) {
      error("Missing required environment variables.");

      return jsonError(
        res,
        500,
        "سرویس موقتاً در دسترس نیست"
      );
    }

    const body = req.bodyJson || {};

    const action = String(body.action || "");
    const code = String(body.code || "").trim();
    const deviceId = String(body.device_id || "").trim();

    if (!["activate", "validate"].includes(action)) {
      return jsonError(
        res,
        400,
        "درخواست نامعتبر است"
      );
    }

    if (
      !/^[A-Za-z0-9-]{8,64}$/.test(code) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)
    ) {
      return jsonError(
        res,
        400,
        "کد یا شناسه دستگاه نامعتبر است"
      );
    }

    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);

    const tables = new TablesDB(client);

    const codeHash = hashValue(code, pepper);
    const deviceHash = hashValue(deviceId, pepper);

    // Find license by its HMAC hash.
    const result = await tables.listRows({
      databaseId: DATABASE_ID,
      tableId: LICENSES_TABLE_ID,
      queries: [
        Query.equal("code_hash", codeHash)
      ],
      limit: 1
    });

    if (!result.rows || result.rows.length === 0) {
      return jsonError(
        res,
        403,
        "کد معتبر نیست یا قابل استفاده نیست"
      );
    }

    const license = result.rows[0];

    if (license.status !== "active") {
      return jsonError(
        res,
        403,
        "کد معتبر نیست یا قابل استفاده نیست"
      );
    }

    if (license.expires_at) {
      const expiry = new Date(
        license.expires_at
      ).getTime();

      if (
        !Number.isFinite(expiry) ||
        expiry <= Date.now()
      ) {
        return jsonError(
          res,
          403,
          "اعتبار کد به پایان رسیده است"
        );
      }
    }

    // Each license can have only one binding row.
    // The license row ID is used as the binding row ID.
    let binding = null;

    try {
      binding = await tables.getRow({
        databaseId: DATABASE_ID,
        tableId: BINDINGS_TABLE_ID,
        rowId: license.$id
      });
    } catch (e) {
      if (e.code !== 404) {
        throw e;
      }
    }

    // First activation claims the unique binding row.
    if (!binding && action === "activate") {
      try {
        binding = await tables.createRow({
          databaseId: DATABASE_ID,
          tableId: BINDINGS_TABLE_ID,
          rowId: license.$id,
          data: {
            device_hash: deviceHash,
            activated_at: new Date().toISOString()
          }
        });
      } catch (e) {
        // Another simultaneous request may have claimed it.
        if (e.code !== 409) {
          throw e;
        }

        binding = await tables.getRow({
          databaseId: DATABASE_ID,
          tableId: BINDINGS_TABLE_ID,
          rowId: license.$id
        });
      }
    }

    if (!binding) {
      return jsonError(
        res,
        403,
        "این کد هنوز فعال نشده است"
      );
    }

    if (binding.device_hash !== deviceHash) {
      return jsonError(
        res,
        403,
        "این کد روی دستگاه دیگری فعال شده است"
      );
    }

    return res.json({
      success: true,
      message:
        action === "activate"
          ? "فعال‌سازی موفق بود"
          : "مجوز معتبر است"
    });

  } catch (e) {
    error(e?.stack || e?.message || String(e));

    return jsonError(
      res,
      500,
      "خطای داخلی سرور"
    );
  }
};

