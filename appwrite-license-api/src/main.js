
import { Client, TablesDB, Query } from "node-appwrite";
import crypto from "node:crypto";

const DATABASE_ID = "train_license_db";
const LICENSES_TABLE_ID = "licenses";
const BINDINGS_TABLE_ID = "license_bindings";

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function hashValue(value, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    .update(value, "utf8")
    .digest("hex");
}

function getHeader(headers, name) {
  const wanted = name.toLowerCase();

  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === wanted) {
      return String(value);
    }
  }

  return "";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

async function getBinding(tables, licenseId) {
  try {
    return await tables.getRow({
      databaseId: DATABASE_ID,
      tableId: BINDINGS_TABLE_ID,
      rowId: licenseId
    });
  } catch (e) {
    if (Number(e?.code) === 404) {
      return null;
    }
    throw e;
  }
}

export default async ({ req, log, error }) => {
  try {
    const endpoint =
      process.env.APPWRITE_FUNCTION_API_ENDPOINT;

    const projectId =
      process.env.APPWRITE_FUNCTION_PROJECT_ID;

    const apiKey =
      process.env.APPWRITE_API_KEY;

    const pepper =
      process.env.CODE_PEPPER;

    const adminSecret =
      process.env.ADMIN_SECRET;

    if (
      !endpoint ||
      !projectId ||
      !apiKey ||
      !pepper ||
      !adminSecret
    ) {
      error("Missing required environment variables.");

      return jsonResponse(500, {
        success: false,
        message: "سرویس موقتاً در دسترس نیست"
      });
    }

    const body = req.bodyJson || {};
    const action = String(body.action || "").trim();

    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);

    const tables = new TablesDB(client);

    // -------------------------------
    // ADMIN ACTIONS
    // -------------------------------

    if (action.startsWith("admin_")) {
      const suppliedSecret = getHeader(
        req.headers,
        "x-admin-secret"
      );

      if (!safeEqual(suppliedSecret, adminSecret)) {
        return jsonResponse(401, {
          success: false,
          message: "دسترسی مدیریتی مجاز نیست"
        });
      }

      // CREATE LICENSE
      if (action === "admin_create") {
        let expiresAt = null;

        if (body.expires_at) {
          expiresAt = String(body.expires_at);

          const expiryTime = new Date(expiresAt).getTime();

          if (
            !Number.isFinite(expiryTime) ||
            expiryTime <= Date.now()
          ) {
            return jsonResponse(400, {
              success: false,
              message: "تاریخ انقضا نامعتبر است"
            });
          }
        }

        const code =
          "TRN-" +
          crypto.randomBytes(16).toString("hex").toUpperCase();

        const licenseId = crypto.randomUUID();

        await tables.createRow({
          databaseId: DATABASE_ID,
          tableId: LICENSES_TABLE_ID,
          rowId: licenseId,
          data: {
            code_hash: hashValue(code, pepper),
            status: "active",
            expires_at: expiresAt
          }
        });

        return jsonResponse(201, {
          success: true,
          message: "کد فعال‌سازی ساخته شد",
          code,
          license_id: licenseId,
          expires_at: expiresAt
        });
      }

      // LIST LICENSES
      if (action === "admin_list") {
        const result = await tables.listRows({
          databaseId: DATABASE_ID,
          tableId: LICENSES_TABLE_ID,
          queries: [
            Query.orderDesc("$createdAt"),
            Query.limit(100)
          ]
        });

        return jsonResponse(200, {
          success: true,
          licenses: (result.rows || []).map((row) => ({
            license_id: row.$id,
            status: row.status,
            created_at: row.$createdAt,
            expires_at: row.expires_at || null
          }))
        });
      }

      // BLOCK OR UNBLOCK
      if (
        action === "admin_block" ||
        action === "admin_unblock"
      ) {
        const licenseId = String(
          body.license_id || ""
        ).trim();

        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(licenseId)
        ) {
          return jsonResponse(400, {
            success: false,
            message: "شناسه مجوز نامعتبر است"
          });
        }

        const status =
          action === "admin_block"
            ? "blocked"
            : "active";

        await tables.updateRow({
          databaseId: DATABASE_ID,
          tableId: LICENSES_TABLE_ID,
          rowId: licenseId,
          data: { status }
        });

        return jsonResponse(200, {
          success: true,
          message:
            status === "blocked"
              ? "کد مسدود شد"
              : "کد دوباره فعال شد",
          license_id: licenseId,
          status
        });
      }

      // RESET DEVICE
      if (action === "admin_reset_device") {
        const licenseId = String(
          body.license_id || ""
        ).trim();

        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(licenseId)
        ) {
          return jsonResponse(400, {
            success: false,
            message: "شناسه مجوز نامعتبر است"
          });
        }

        const binding = await getBinding(
          tables,
          licenseId
        );

        if (!binding) {
          return jsonResponse(404, {
            success: false,
            message: "این کد به دستگاهی متصل نیست"
          });
        }

        await tables.deleteRow({
          databaseId: DATABASE_ID,
          tableId: BINDINGS_TABLE_ID,
          rowId: licenseId
        });

        return jsonResponse(200, {
          success: true,
          message:
            "اتصال دستگاه قبلی حذف شد؛ کد آماده فعال‌سازی روی دستگاه جدید است",
          license_id: licenseId
        });
      }

      return jsonResponse(400, {
        success: false,
        message: "عملیات مدیریتی نامعتبر است"
      });
    }

    // -------------------------------
    // PUBLIC ACTIVATION / VALIDATION
    // -------------------------------

    if (!["activate", "validate"].includes(action)) {
      return jsonResponse(400, {
        success: false,
        message: "درخواست نامعتبر است"
      });
    }

    const code = String(body.code || "").trim();
    const deviceId = String(
      body.device_id || ""
    ).trim();

    if (
      !/^[A-Za-z0-9-]{8,64}$/.test(code) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)
    ) {
      return jsonResponse(400, {
        success: false,
        message: "کد یا شناسه دستگاه نامعتبر است"
      });
    }

    const codeHash = hashValue(code, pepper);
    const deviceHash = hashValue(deviceId, pepper);

    const result = await tables.listRows({
      databaseId: DATABASE_ID,
      tableId: LICENSES_TABLE_ID,
      queries: [
        Query.equal("code_hash", codeHash)
      ],
      limit: 1
    });

    if (!result.rows || result.rows.length === 0) {
      return jsonResponse(403, {
        success: false,
        message: "کد معتبر نیست یا قابل استفاده نیست"
      });
    }

    const license = result.rows[0];

    if (license.status !== "active") {
      return jsonResponse(403, {
        success: false,
        message: "کد معتبر نیست یا قابل استفاده نیست"
      });
    }

    if (license.expires_at) {
      const expiry = new Date(
        license.expires_at
      ).getTime();

      if (
        !Number.isFinite(expiry) ||
        expiry <= Date.now()
      ) {
        return jsonResponse(403, {
          success: false,
          message: "اعتبار کد به پایان رسیده است"
        });
      }
    }

    let binding = await getBinding(
      tables,
      license.$id
    );

    // First activation claims the license.
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
        if (Number(e?.code) !== 409) {
          throw e;
        }

        binding = await getBinding(
          tables,
          license.$id
        );
      }
    }

    if (!binding) {
      return jsonResponse(403, {
        success: false,
        message: "این کد هنوز فعال نشده است"
      });
    }

    if (binding.device_hash !== deviceHash) {
      return jsonResponse(403, {
        success: false,
        message: "این کد روی دستگاه دیگری فعال شده است"
      });
    }

    return jsonResponse(200, {
      success: true,
      message:
        action === "activate"
          ? "فعال‌سازی موفق بود"
          : "مجوز معتبر است"
    });

  } catch (e) {
    error(e?.stack || e?.message || String(e));

    return jsonResponse(500, {
      success: false,
      message: "خطای داخلی سرور"
    });
  }
};
