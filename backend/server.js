const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const dbModule = require("./config/database");

const app = express();
const PORT = 5000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================
// ACTIVITY LOG - IN-MEMORY STORAGE
// ============================================
let activityLogs = [];
const MAX_LOGS = 100;

const logActivity = (userId, action, tableName, recordId = null) => {
  try {
    const logEntry = {
      log_id: Date.now(),
      user_id: userId || 1,
      username: "Unknown",
      action: action,
      table_name: tableName,
      record_id: recordId,
      action_date: new Date().toISOString(),
    };
    activityLogs.unshift(logEntry);
    if (activityLogs.length > MAX_LOGS) {
      activityLogs = activityLogs.slice(0, MAX_LOGS);
    }
    console.log(`📝 [LOG] User ${userId}: ${action} on ${tableName}`);
  } catch (err) {
    console.warn("⚠️ Activity log error:", err.message);
  }
};

app.get("/api/activity-logs", (req, res) => {
  const { limit = 50 } = req.query;
  const logs = activityLogs.slice(0, Number(limit));
  dbModule.all("SELECT UserID, Username FROM Tbl_Users", [], (err, users) => {
    if (!err && users) {
      const userMap = {};
      users.forEach((u) => {
        userMap[u.UserID] = u.Username;
      });
      logs.forEach((log) => {
        log.username = userMap[log.user_id] || "Unknown";
      });
    }
    res.json(logs);
  });
});

app.delete("/api/activity-logs", (req, res) => {
  activityLogs = [];
  res.json({ message: "Activity logs cleared" });
});

// ============================================
// AUTHENTICATION
// ============================================

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  console.log("🔑 Login attempt:", username);

  const safeUsername = username.replace(/'/g, "''");
  const safePassword = password.replace(/'/g, "''");

  const sql = `
    SELECT UserID, Username, Password, Role, Status 
    FROM Tbl_Users 
    WHERE Username = '${safeUsername}' 
    AND Password = '${safePassword}' 
    AND Status = 'ACTIVE'
  `;

  dbModule.get(sql, [], (err, user) => {
    if (err) {
      console.error("❌ Login error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      console.log("❌ User not found");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    console.log("✅ Login successful:", username);
    console.log("👤 Role:", user.Role);

    logActivity(user.UserID, "Login", "Tbl_Users", user.UserID);

    delete user.Password;
    res.json({
      user_id: user.UserID,
      username: user.Username,
      role: user.Role || "Cashier",
      role_name: user.Role || "Cashier",
      status: user.Status,
    });
  });
});

// ============================================
// DASHBOARD STATS
// ============================================

app.get("/api/dashboard/stats", (req, res) => {
  let stats = {
    totalCustomers: 0,
    totalProducts: 0,
    totalOrders: 0,
    totalRevenue: 0,
    lowStockItems: 0,
    pendingOrders: 0,
  };
  let completed = 0;

  const checkComplete = () => {
    if (completed === 6) {
      res.json(stats);
    }
  };

  dbModule.get(
    "SELECT COUNT(*) as count FROM TBL_CUSTOMERS WHERE STATUS = 'Active'",
    [],
    (err, r) => {
      stats.totalCustomers = r?.count || 0;
      completed++;
      checkComplete();
    }
  );

  dbModule.get(
    "SELECT COUNT(*) as count FROM TBL_PRODUCTS WHERE STATUS = 'Active'",
    [],
    (err, r) => {
      stats.totalProducts = r?.count || 0;
      completed++;
      checkComplete();
    }
  );

  dbModule.get("SELECT COUNT(*) as count FROM TBL_ORDERS", [], (err, r) => {
    stats.totalOrders = r?.count || 0;
    completed++;
    checkComplete();
  });

  dbModule.get(
    "SELECT SUM(AMOUNT_US) as revenue FROM TBL_ORDERS",
    [],
    (err, r) => {
      stats.totalRevenue = r?.revenue || 0;
      completed++;
      checkComplete();
    }
  );

  dbModule.get(
    "SELECT COUNT(*) as count FROM Tbl_Stock WHERE QtyAvailable <= 5",
    [],
    (err, r) => {
      stats.lowStockItems = r?.count || 0;
      completed++;
      checkComplete();
    }
  );

  dbModule.get(
    "SELECT COUNT(*) as count FROM TBL_ORDERS WHERE STATUS = 'Pending'",
    [],
    (err, r) => {
      stats.pendingOrders = r?.count || 0;
      completed++;
      checkComplete();
    }
  );
});

// ============================================
// CUSTOMERS (CRUD)
// ============================================

app.get("/api/customers", (req, res) => {
  const { search } = req.query;
  let sql = "SELECT * FROM TBL_CUSTOMERS WHERE STATUS = 'Active'";

  if (search) {
    const safeSearch = search.replace(/'/g, "''");
    sql += ` AND (FIRST_NAME LIKE '%${safeSearch}%' OR LAST_NAME LIKE '%${safeSearch}%' OR PHONE LIKE '%${safeSearch}%' OR E_MAIL LIKE '%${safeSearch}%')`;
  }

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Customers error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`👥 Customers found: ${rows.length}`);
    res.json(rows);
  });
});

app.get("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  dbModule.get(
    `SELECT * FROM TBL_CUSTOMERS WHERE CUS_ID = '${id}'`,
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Customer not found" });
      res.json(row);
    }
  );
});

app.post("/api/customers", (req, res) => {
  const { FIRST_NAME, LAST_NAME, PHONE, E_MAIL, ADDRESS } = req.body;

  if (!FIRST_NAME || !LAST_NAME) {
    return res
      .status(400)
      .json({ error: "First name and last name are required" });
  }

  const safeFirstName = (FIRST_NAME || "").replace(/'/g, "''");
  const safeLastName = (LAST_NAME || "").replace(/'/g, "''");
  const safePhone = (PHONE || "").replace(/'/g, "''");
  const safeEmail = (E_MAIL || "").replace(/'/g, "''");
  const safeAddress = (ADDRESS || "").replace(/'/g, "''");

  const getNextIdSql = `SELECT MAX(CUS_ID) as maxId FROM TBL_CUSTOMERS`;

  dbModule.get(getNextIdSql, [], (err, result) => {
    if (err) {
      console.error("❌ Get next ID error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    let nextNumber = 1;
    if (result && result.maxId) {
      const currentId = result.maxId;
      const numPart = parseInt(currentId.replace(/[^0-9]/g, ""));
      if (!isNaN(numPart)) {
        nextNumber = numPart + 1;
      }
    }
    const newCusId = `CUS${String(nextNumber).padStart(3, "0")}`;
    console.log(`🔑 Generated CUS_ID: ${newCusId}`);

    const sql = `
      INSERT INTO TBL_CUSTOMERS (CUS_ID, FIRST_NAME, LAST_NAME, PHONE, E_MAIL, ADDRESS, STATUS) 
      VALUES ('${newCusId}', '${safeFirstName}', '${safeLastName}', '${safePhone}', '${safeEmail}', '${safeAddress}', 'Active')
    `;

    console.log("📝 SQL:", sql);

    dbModule.run(sql, [], function (err) {
      if (err) {
        console.error("❌ Create customer error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      logActivity(
        req.body.user_id || 1,
        "Created customer",
        "TBL_CUSTOMERS",
        newCusId
      );
      res.json({
        cus_id: newCusId,
        message: "Customer created successfully",
      });
    });
  });
});

app.put("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  const { FIRST_NAME, LAST_NAME, PHONE, E_MAIL, ADDRESS, BALANCE, STATUS } =
    req.body;

  const safeFirstName = (FIRST_NAME || "").replace(/'/g, "''");
  const safeLastName = (LAST_NAME || "").replace(/'/g, "''");
  const safePhone = (PHONE || "").replace(/'/g, "''");
  const safeEmail = (E_MAIL || "").replace(/'/g, "''");
  const safeAddress = (ADDRESS || "").replace(/'/g, "''");
  const safeStatus = (STATUS || "Active").replace(/'/g, "''");
  const balance = BALANCE || 0;

  const sql = `
    UPDATE TBL_CUSTOMERS 
    SET FIRST_NAME = '${safeFirstName}', 
        LAST_NAME = '${safeLastName}', 
        PHONE = '${safePhone}', 
        E_MAIL = '${safeEmail}', 
        ADDRESS = '${safeAddress}', 
        BALANCE = ${balance}, 
        STATUS = '${safeStatus}' 
    WHERE CUS_ID = '${id}'
  `;

  dbModule.run(sql, [], function (err) {
    if (err) {
      console.error("❌ Update customer error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0)
      return res.status(404).json({ error: "Customer not found" });

    logActivity(req.body.user_id || 1, "Updated customer", "TBL_CUSTOMERS", id);
    res.json({ message: "Customer updated successfully" });
  });
});

app.delete("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  dbModule.run(
    `UPDATE TBL_CUSTOMERS SET STATUS = 'Inactive' WHERE CUS_ID = '${id}'`,
    [],
    function (err) {
      if (err) {
        console.error("❌ Delete customer error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Customer not found" });

      logActivity(
        req.body.user_id || 1,
        "Deleted customer",
        "TBL_CUSTOMERS",
        id
      );
      res.json({ message: "Customer deleted successfully" });
    }
  );
});

// ============================================
// PRODUCTS (CRUD)
// ============================================

app.get("/api/products", (req, res) => {
  const { search } = req.query;
  let sql = "SELECT * FROM TBL_PRODUCTS WHERE STATUS = 'Active'";

  if (search) {
    const safeSearch = search.replace(/'/g, "''");
    sql += ` AND (NAME_EN LIKE '%${safeSearch}%' OR NAME_KH LIKE '%${safeSearch}%' OR BARCODE LIKE '%${safeSearch}%')`;
  }

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Products error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`📦 Products found: ${rows.length}`);
    res.json(rows);
  });
});

app.get("/api/products/:id", (req, res) => {
  const { id } = req.params;
  dbModule.get(
    `SELECT * FROM TBL_PRODUCTS WHERE PRODUCT_ID = '${id}'`,
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Product not found" });
      res.json(row);
    }
  );
});

app.post("/api/products", (req, res) => {
  const {
    NAME_EN,
    NAME_KH,
    BARCODE,
    BRAND,
    CATEGORY_ID,
    BUYIN_PRICE,
    SALEOUT_PRICE,
    QTY_ALERT,
    QTY_INSTOCK,
  } = req.body;

  if (!NAME_EN || !NAME_KH) {
    return res.status(400).json({ error: "Product name is required" });
  }

  const safeNameEn = (NAME_EN || "").replace(/'/g, "''");
  const safeNameKh = (NAME_KH || "").replace(/'/g, "''");
  const safeBarcode = (BARCODE || "").replace(/'/g, "''");
  const safeBrand = (BRAND || "").replace(/'/g, "''");
  const buyPrice = BUYIN_PRICE || 0;
  const salePrice = SALEOUT_PRICE || 0;
  const qtyAlert = QTY_ALERT || 10;

  const getNextIdSql = `SELECT MAX(PRODUCT_ID) as maxId FROM TBL_PRODUCTS`;

  dbModule.get(getNextIdSql, [], (err, result) => {
    if (err) {
      console.error("❌ Get next product ID error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    let nextNumber = 1;
    if (result && result.maxId) {
      const numPart = parseInt(String(result.maxId).replace(/[^0-9]/g, ""));
      if (!isNaN(numPart)) {
        nextNumber = numPart + 1;
      }
    }
    const newProductId = `PROD${String(nextNumber).padStart(3, "0")}`;
    console.log(`🔑 Generated PRODUCT_ID: ${newProductId}`);

    const sql = `
      INSERT INTO TBL_PRODUCTS (PRODUCT_ID, NAME_EN, NAME_KH, BARCODE, BRAND, CATEGORY_ID, BUYIN_PRICE, SALEOUT_PRICE, QTY_ALERT, STATUS) 
      VALUES ('${newProductId}', '${safeNameEn}', '${safeNameKh}', '${safeBarcode}', '${safeBrand}', ${CATEGORY_ID || "NULL"}, ${buyPrice}, ${salePrice}, ${qtyAlert}, 'Active')
    `;

    console.log("📝 SQL:", sql);

    dbModule.run(sql, [], function (err) {
      if (err) {
        console.error("❌ Create product error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      const productId = this.lastID;

      dbModule.run(
        `INSERT INTO Tbl_Stock (ProductID, QtyInStock, QtyAvailable) VALUES (${productId}, ${QTY_INSTOCK || 0}, ${QTY_INSTOCK || 0})`,
        [],
        function (err) {
          if (err) {
            console.error("❌ Create stock error:", err.message);
            return res.status(500).json({ error: err.message });
          }

          logActivity(
            req.body.user_id || 1,
            "Created product",
            "TBL_PRODUCTS",
            newProductId
          );
          res.json({
            product_id: newProductId,
            message: "Product created successfully",
          });
        }
      );
    });
  });
});

app.put("/api/products/:id", (req, res) => {
  const { id } = req.params;
  const {
    NAME_EN,
    NAME_KH,
    BARCODE,
    BRAND,
    CATEGORY_ID,
    BUYIN_PRICE,
    SALEOUT_PRICE,
    QTY_ALERT,
    STATUS,
  } = req.body;

  const safeNameEn = (NAME_EN || "").replace(/'/g, "''");
  const safeNameKh = (NAME_KH || "").replace(/'/g, "''");
  const safeBarcode = (BARCODE || "").replace(/'/g, "''");
  const safeBrand = (BRAND || "").replace(/'/g, "''");
  const safeStatus = (STATUS || "Active").replace(/'/g, "''");

  const sql = `
    UPDATE TBL_PRODUCTS 
    SET NAME_EN = '${safeNameEn}', 
        NAME_KH = '${safeNameKh}', 
        BARCODE = '${safeBarcode}', 
        BRAND = '${safeBrand}', 
        CATEGORY_ID = ${CATEGORY_ID || "NULL"}, 
        BUYIN_PRICE = ${BUYIN_PRICE || 0}, 
        SALEOUT_PRICE = ${SALEOUT_PRICE || 0}, 
        QTY_ALERT = ${QTY_ALERT || 10}, 
        STATUS = '${safeStatus}' 
    WHERE PRODUCT_ID = '${id}'
  `;

  dbModule.run(sql, [], function (err) {
    if (err) {
      console.error("❌ Update product error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0)
      return res.status(404).json({ error: "Product not found" });

    logActivity(req.body.user_id || 1, "Updated product", "TBL_PRODUCTS", id);
    res.json({ message: "Product updated successfully" });
  });
});

app.delete("/api/products/:id", (req, res) => {
  const { id } = req.params;
  dbModule.run(
    `UPDATE TBL_PRODUCTS SET STATUS = 'Inactive' WHERE PRODUCT_ID = '${id}'`,
    [],
    function (err) {
      if (err) {
        console.error("❌ Delete product error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Product not found" });

      logActivity(req.body.user_id || 1, "Deleted product", "TBL_PRODUCTS", id);
      res.json({ message: "Product deleted successfully" });
    }
  );
});

// ============================================
// ORDERS
// ============================================

app.get("/api/orders", (req, res) => {
  const { limit = 50, status } = req.query;

  let sql = "SELECT * FROM TBL_ORDERS";

  if (status) {
    const safeStatus = status.replace(/'/g, "''");
    sql += ` WHERE STATUS = '${safeStatus}'`;
  }

  sql += " ORDER BY ORDER_DATE DESC";

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Orders error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    const limitedRows = rows.slice(0, Number(limit));
    console.log(`📋 Orders found: ${limitedRows.length}`);
    res.json(limitedRows);
  });
});

app.get("/api/orders/recent", (req, res) => {
  dbModule.all(
    "SELECT * FROM TBL_ORDERS ORDER BY ORDER_DATE DESC",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ Recent orders error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      const recent = rows.slice(0, 10);
      res.json(recent);
    }
  );
});

// ============================================
// ORDER DETAILS
// ============================================
app.get("/api/orders/:id", (req, res) => {
  const { id } = req.params;
  console.log(`📊 Fetching order details for ID: ${id}`);

  const orderSql = `
    SELECT 
      OR_ID,
      ORDER_NO,
      ORDER_DATE,
      AMOUNT_US,
      STATUS,
      PaymentMethod,
      NOTES,
      EMP_PREPARE,
      CUSTOMER_ID
    FROM TBL_ORDERS
    WHERE OR_ID = ${Number(id)}
  `;

  dbModule.get(orderSql, [], (err, order) => {
    if (err) {
      console.error("❌ Order error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const customerSql = `
      SELECT 
        CUS_ID,
        FIRST_NAME,
        LAST_NAME,
        PHONE,
        E_MAIL
      FROM TBL_CUSTOMERS
      WHERE CUS_ID = 'CUS${String(order.CUSTOMER_ID).padStart(3, "0")}' OR CUS_ID = '${order.CUSTOMER_ID}'
    `;

    dbModule.get(customerSql, [], (err2, customer) => {
      if (err2) {
        console.warn("⚠️ Customer error:", err2.message);
        customer = null;
      }

      const paymentSql = `
        SELECT * FROM TBL_PAYMENT
        WHERE OR_ID = ${Number(id)}
      `;

      dbModule.all(paymentSql, [], (err3, payments) => {
        if (err3) {
          console.warn("⚠️ Payments error:", err3.message);
          payments = [];
        }

        const itemsSql = `
          SELECT 
            ID,
            OR_ID,
            PRODUCT_ID,
            QTY_ORDER as qty,
            QTY_BONUS,
            PRICE as unit_price,
            DISCOUNT,
            SUBTOTAL as subtotal
          FROM TBL_ORDERS_DETAILS
          WHERE OR_ID = ${Number(id)}
        `;

        dbModule.all(itemsSql, [], (err4, items) => {
          if (err4) {
            console.warn("⚠️ Items error:", err4.message);
            items = [];
          }

          res.json({
            OR_ID: order.OR_ID,
            ORDER_NO: order.ORDER_NO,
            ORDER_DATE: order.ORDER_DATE,
            AMOUNT_US: order.AMOUNT_US,
            STATUS: order.STATUS,
            PaymentMethod: order.PaymentMethod,
            NOTES: order.NOTES,
            EMP_PREPARE: order.EMP_PREPARE,
            CUSTOMER_ID: order.CUSTOMER_ID,
            customer: customer || {
              CUS_ID: order.CUSTOMER_ID,
              FIRST_NAME: "Unknown",
              LAST_NAME: "Customer",
              PHONE: null,
              E_MAIL: null,
            },
            payments: payments || [],
            items: items || [],
          });
        });
      });
    });
  });
});

// ============================================
// PAYMENT METHODS
// ============================================
app.get("/api/payment-methods", (req, res) => {
  console.log("💳 Fetching payment methods...");

  dbModule.all(
    'SELECT * FROM TBL_PAYMENT_METHOD WHERE STATUS = "ACTIVE"',
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ Payment methods error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`💳 Payment methods found: ${rows.length}`);
      res.json(rows);
    }
  );
});

// ============================================
// STOCK MANAGEMENT
// ============================================

app.get("/api/stock", (req, res) => {
  dbModule.all("SELECT * FROM Tbl_Stock", [], (err, rows) => {
    if (err) {
      console.error("❌ Stock error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`📊 Stock records found: ${rows.length}`);
    res.json(rows);
  });
});

// ============================================
// STOCK CHECK
// ============================================
app.get("/api/stock/product/:id", (req, res) => {
  const { id } = req.params;
  console.log(`📊 Checking stock for product ID: ${id}`);

  if (!id || id === "null" || id === "undefined") {
    return res.json({
      ProductID: id,
      QtyInStock: 0,
      QtyReserved: 0,
      QtyAvailable: 0,
      PRODUCT_NAME: "Unknown",
    });
  }

  const productIdText = String(id);
  const findProductSql = `SELECT ID, PRODUCT_ID, NAME_EN FROM TBL_PRODUCTS WHERE PRODUCT_ID = '${productIdText}'`;
  console.log("🔍 SQL:", findProductSql);

  dbModule.get(findProductSql, [], (err, product) => {
    if (err || !product) {
      console.warn(`⚠️ Product ${productIdText} not found in TBL_PRODUCTS`);
      return res.json({
        ProductID: productIdText,
        QtyInStock: 0,
        QtyReserved: 0,
        QtyAvailable: 0,
        PRODUCT_NAME: "Unknown",
      });
    }

    const numericProductId = product.ID;
    console.log(
      `🔍 Found product with numeric ID: ${numericProductId}, Name: ${product.NAME_EN}`
    );

    const checkSql = `SELECT * FROM Tbl_Stock WHERE ProductID = ${numericProductId}`;
    console.log("🔍 SQL:", checkSql);

    dbModule.get(checkSql, [], (err2, stock) => {
      if (err2) {
        console.error("❌ Stock check error:", err2.message);
        return res.json({
          ProductID: productIdText,
          QtyInStock: 0,
          QtyReserved: 0,
          QtyAvailable: 0,
          PRODUCT_NAME: product.NAME_EN || "Unknown",
        });
      }

      if (!stock) {
        const createSql = `INSERT INTO Tbl_Stock (ProductID, QtyInStock, QtyAvailable, QtyReserved) VALUES (${numericProductId}, 0, 0, 0)`;
        console.log("🔍 SQL:", createSql);
        dbModule.run(createSql, [], function () {
          return res.json({
            ProductID: productIdText,
            QtyInStock: 0,
            QtyReserved: 0,
            QtyAvailable: 0,
            PRODUCT_NAME: product.NAME_EN || "Unknown",
          });
        });
        return;
      }

      res.json({
        ProductID: productIdText,
        StockID: stock.StockID,
        QtyInStock: stock.QtyInStock || 0,
        QtyReserved: stock.QtyReserved || 0,
        QtyAvailable: stock.QtyAvailable || 0,
        LastUpdated: stock.LastUpdated || null,
        PRODUCT_NAME: product.NAME_EN || "Unknown",
      });
    });
  });
});

// ============================================
// SUPPLIERS
// ============================================

app.get("/api/suppliers", (req, res) => {
  const { search } = req.query;
  console.log("🔍 GET /api/suppliers - search:", search);

  let sql = "SELECT * FROM TBL_SUPPLIERS WHERE STATUS = 'Active'";

  if (search) {
    const safeSearch = search.replace(/'/g, "''");
    sql += ` AND (COMPANY LIKE '%${safeSearch}%' OR FIRST_NAME LIKE '%${safeSearch}%' OR LAST_NAME LIKE '%${safeSearch}%' OR PHONE LIKE '%${safeSearch}%' OR E_MAIL LIKE '%${safeSearch}%')`;
  }

  sql += " ORDER BY COMPANY";

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Suppliers error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    const mappedRows = rows.map(row => ({
      SUP_ID: row.SUP_ID,
      SUP_NAME: row.COMPANY,
      CONTACT_PERSON: `${row.FIRST_NAME || ''} ${row.LAST_NAME || ''}`.trim() || row.FIRST_NAME || row.LAST_NAME || '',
      PHONE: row.PHONE,
      EMAIL: row.E_MAIL,
      ADDRESS: row.ADDRESS,
      STATUS: row.STATUS,
      WEBSITE: row.WEBSITE,
      PAYMENT_TI: row.PAYMENT_TI
    }));

    console.log(`🚚 Suppliers found: ${mappedRows.length}`);
    res.json(mappedRows);
  });
});

app.get("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  console.log(`🔍 GET /api/suppliers/${id}`);

  dbModule.get(
    `SELECT * FROM TBL_SUPPLIERS WHERE SUP_ID = '${id}'`,
    [],
    (err, row) => {
      if (err) {
        console.error("❌ Supplier error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: "Supplier not found" });
      }

      const mappedRow = {
        SUP_ID: row.SUP_ID,
        SUP_NAME: row.COMPANY,
        CONTACT_PERSON: `${row.FIRST_NAME || ''} ${row.LAST_NAME || ''}`.trim() || row.FIRST_NAME || row.LAST_NAME || '',
        PHONE: row.PHONE,
        EMAIL: row.E_MAIL,
        ADDRESS: row.ADDRESS,
        STATUS: row.STATUS,
        WEBSITE: row.WEBSITE,
        PAYMENT_TI: row.PAYMENT_TI
      };

      res.json(mappedRow);
    }
  );
});

app.post("/api/suppliers", (req, res) => {
  console.log("📝 POST /api/suppliers - Request body:", JSON.stringify(req.body, null, 2));

  const supName = req.body.SUP_NAME || req.body.COMPANY || req.body.company || req.body.name || req.body.supplierName;
  const contactPerson = req.body.CONTACT_PERSON || req.body.contactPerson || req.body.contact_person || req.body.contact || '';
  const phone = req.body.PHONE || req.body.phone || '';
  const email = req.body.EMAIL || req.body.E_MAIL || req.body.email || '';
  const address = req.body.ADDRESS || req.body.address || '';

  console.log("📝 Extracted values:", { supName, contactPerson, phone, email, address });

  if (!supName) {
    console.error("❌ Missing supplier name");
    return res.status(400).json({
      error: "Supplier name is required",
      received: req.body
    });
  }

  let firstName = '';
  let lastName = '';
  if (contactPerson) {
    const isPhoneNumber = /^[0-9\s\-+()]+$/.test(contactPerson);
    if (isPhoneNumber) {
      firstName = contactPerson;
      lastName = '';
    } else {
      const parts = contactPerson.trim().split(' ');
      if (parts.length > 1) {
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      } else {
        firstName = parts[0];
        lastName = '';
      }
    }
  }

  const safeCompany = (supName || "").replace(/'/g, "''");
  const safeFirstName = (firstName || "").replace(/'/g, "''");
  const safeLastName = (lastName || "").replace(/'/g, "''");
  const safePhone = (phone || "").replace(/'/g, "''");
  const safeEmail = (email || "").replace(/'/g, "''");
  const safeAddress = (address || "").replace(/'/g, "''");

  const getNextIdSql = `SELECT MAX(SUP_ID) as maxId FROM TBL_SUPPLIERS`;

  dbModule.get(getNextIdSql, [], (err, result) => {
    if (err) {
      console.error("❌ Get next ID error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    let nextNumber = 1;
    if (result && result.maxId) {
      const currentId = result.maxId;
      const numPart = parseInt(currentId.replace(/[^0-9]/g, ""));
      if (!isNaN(numPart)) {
        nextNumber = numPart + 1;
      }
    }
    const newSupId = `SUP${String(nextNumber).padStart(3, "0")}`;
    console.log(`🔑 Generated SUP_ID: ${newSupId}`);

    const sql = `
      INSERT INTO TBL_SUPPLIERS (
        SUP_ID, 
        COMPANY, 
        FIRST_NAME, 
        LAST_NAME, 
        PHONE, 
        E_MAIL, 
        ADDRESS,
        STATUS
      ) VALUES (
        '${newSupId}',
        '${safeCompany}',
        '${safeFirstName}',
        '${safeLastName}',
        '${safePhone}',
        '${safeEmail}',
        '${safeAddress}',
        'Active'
      )
    `;

    console.log("📝 SQL:", sql);

    dbModule.run(sql, [], function (err) {
      if (err) {
        console.error("❌ Create supplier error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      logActivity(
        req.body.user_id || 1,
        "Created supplier",
        "TBL_SUPPLIERS",
        newSupId
      );

      res.json({
        SUP_ID: newSupId,
        SUP_NAME: safeCompany,
        CONTACT_PERSON: contactPerson,
        PHONE: safePhone,
        EMAIL: safeEmail,
        ADDRESS: safeAddress,
        STATUS: 'Active',
        message: "Supplier created successfully",
      });
    });
  });
});

app.put("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  console.log(`📝 PUT /api/suppliers/${id} - Request body:`, JSON.stringify(req.body, null, 2));

  const supName = req.body.SUP_NAME || req.body.COMPANY || req.body.company || req.body.name;
  const contactPerson = req.body.CONTACT_PERSON || req.body.contactPerson || req.body.contact_person || '';
  const phone = req.body.PHONE || req.body.phone || '';
  const email = req.body.EMAIL || req.body.E_MAIL || req.body.email || '';
  const address = req.body.ADDRESS || req.body.address || '';
  const status = req.body.STATUS || req.body.status || 'Active';

  if (!supName) {
    console.error("❌ Missing supplier name");
    return res.status(400).json({
      error: "Supplier name is required",
      received: req.body
    });
  }

  let firstName = '';
  let lastName = '';
  if (contactPerson) {
    const isPhoneNumber = /^[0-9\s\-+()]+$/.test(contactPerson);
    if (isPhoneNumber) {
      firstName = contactPerson;
      lastName = '';
    } else {
      const parts = contactPerson.trim().split(' ');
      if (parts.length > 1) {
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      } else {
        firstName = parts[0];
        lastName = '';
      }
    }
  }

  const safeCompany = (supName || "").replace(/'/g, "''");
  const safeFirstName = (firstName || "").replace(/'/g, "''");
  const safeLastName = (lastName || "").replace(/'/g, "''");
  const safePhone = (phone || "").replace(/'/g, "''");
  const safeEmail = (email || "").replace(/'/g, "''");
  const safeAddress = (address || "").replace(/'/g, "''");
  const safeStatus = (status || "Active").replace(/'/g, "''");

  const sql = `
    UPDATE TBL_SUPPLIERS 
    SET COMPANY = '${safeCompany}',
        FIRST_NAME = '${safeFirstName}',
        LAST_NAME = '${safeLastName}',
        PHONE = '${safePhone}',
        E_MAIL = '${safeEmail}',
        ADDRESS = '${safeAddress}',
        STATUS = '${safeStatus}'
    WHERE SUP_ID = '${id}'
  `;

  console.log("📝 SQL:", sql);

  dbModule.run(sql, [], function (err) {
    if (err) {
      console.error("❌ Update supplier error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    logActivity(req.body.user_id || 1, "Updated supplier", "TBL_SUPPLIERS", id);

    res.json({
      message: "Supplier updated successfully",
      SUP_ID: id,
      SUP_NAME: safeCompany,
      CONTACT_PERSON: contactPerson,
      PHONE: safePhone,
      EMAIL: safeEmail,
      ADDRESS: safeAddress,
      STATUS: safeStatus
    });
  });
});

app.delete("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  console.log(`🗑️ DELETE /api/suppliers/${id}`);

  dbModule.run(
    `UPDATE TBL_SUPPLIERS SET STATUS = 'Inactive' WHERE SUP_ID = '${id}'`,
    [],
    function (err) {
      if (err) {
        console.error("❌ Delete supplier error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Supplier not found" });
      }

      logActivity(
        req.body.user_id || 1,
        "Deleted supplier",
        "TBL_SUPPLIERS",
        id
      );
      res.json({ message: "Supplier deleted successfully" });
    }
  );
});

// ============================================
// REPORTS API
// ============================================

app.get("/api/reports/customers", (req, res) => {
  console.log("📊 Generating Customer Report...");

  dbModule.all(
    "SELECT * FROM TBL_CUSTOMERS WHERE STATUS = 'Active' ORDER BY FIRST_NAME, LAST_NAME",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ Customer report error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`📊 Customer report: ${rows.length} records`);
      res.json(rows || []);
    }
  );
});

app.get("/api/reports/products", (req, res) => {
  console.log("📊 Generating Product Report...");

  const sql = `
    SELECT 
      ID,
      PRODUCT_ID,
      NAME_EN,
      NAME_KH,
      SALEOUT_PRICE as PRICE,
      STATUS
    FROM TBL_PRODUCTS
    WHERE STATUS = 'Active'
    ORDER BY NAME_EN
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Product report error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`📊 Product report: ${rows.length} records`);
    res.json(rows || []);
  });
});

app.get("/api/reports/orders", (req, res) => {
  console.log("📊 Generating Order Report...");

  const sql = `
    SELECT 
      ORDER_NO,
      ORDER_DATE,
      AMOUNT_US as TOTAL_AMOUNT,
      STATUS
    FROM TBL_ORDERS
    ORDER BY ORDER_DATE DESC
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Order report error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`📊 Order report: ${rows.length} records`);
    res.json(rows || []);
  });
});

app.get("/api/reports/stock", (req, res) => {
  console.log("📊 Generating Stock Report...");

  const sql = `
    SELECT 
      s.StockID,
      s.ProductID,
      p.PRODUCT_ID as PRODUCT_CODE,
      p.NAME_EN as PRODUCT_NAME,
      s.QtyInStock as IN_STOCK,
      s.QtyAvailable as AVAILABLE,
      s.QtyReserved as RESERVED,
      s.LastUpdated
    FROM Tbl_Stock s
    LEFT JOIN TBL_PRODUCTS p ON s.ProductID = p.ID
    ORDER BY p.NAME_EN
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Stock report error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`📊 Stock report: ${rows.length} records`);
    res.json(rows || []);
  });
});

// ============================================
// ANALYTICS API
// ============================================

// Helper: Get start date for range filter
function getStartDateForRange(range) {
  const d = new Date();
  switch (range) {
    case "last30days":
      d.setDate(d.getDate() - 30);
      break;
    case "last90days":
      d.setDate(d.getDate() - 90);
      break;
    case "last12months":
      d.setMonth(d.getMonth() - 12);
      break;
    case "last6months":
    default:
      d.setMonth(d.getMonth() - 6);
      break;
  }
  return d.toISOString().slice(0, 10);
}

// Helper: Safe number conversion
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Helper: Calculate growth percentage
function growthPct(current, previous) {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

app.get("/api/analytics/monthly-revenue", (req, res) => {
  const { range = "last6months" } = req.query;
  const startDate = getStartDateForRange(range);
  console.log(`📊 Fetching monthly revenue (range=${range}, since ${startDate})...`);

  const sql = `
    SELECT
      DatePart('yyyy', ORDER_DATE) as year,
      DatePart('m', ORDER_DATE) as month,
      SUM(AMOUNT_US) as revenue,
      COUNT(*) as orders
    FROM TBL_ORDERS
    WHERE ORDER_DATE >= ?
    GROUP BY DatePart('yyyy', ORDER_DATE), DatePart('m', ORDER_DATE)
    ORDER BY DatePart('yyyy', ORDER_DATE) ASC, DatePart('m', ORDER_DATE) ASC
  `;

  dbModule.all(sql, [startDate], (err, rows) => {
    if (err) {
      console.error("❌ Monthly revenue error:", err.message);
      return res.status(500).json([]);
    }
    const formatted = rows.map((row) => ({
      month: `${MONTH_NAMES[(row.month || 1) - 1]} ${row.year || ""}`.trim(),
      revenue: num(row.revenue),
      orders: num(row.orders),
    }));
    console.log(`📊 Monthly revenue: ${formatted.length} rows`);
    res.json(formatted);
  });
});

app.get("/api/analytics/top-products", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  console.log(`📊 Fetching top ${limit} products...`);

  const sql = `
    SELECT TOP ${limit}
      p.NAME_EN as product_name,
      SUM(od.QTY_ORDER) as total_sold,
      SUM(od.QTY_ORDER * od.PRICE) as revenue
    FROM TBL_ORDERS_DETAILS od
    LEFT JOIN TBL_PRODUCTS p ON od.PRODUCT_ID = p.ID
    GROUP BY p.NAME_EN
    ORDER BY SUM(od.QTY_ORDER) DESC
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Top products error:", err.message);
      return res.status(500).json([]);
    }
    const formatted = rows.map((r) => ({
      product_name: r.product_name || "Unknown",
      total_sold: num(r.total_sold),
      revenue: num(r.revenue),
    }));
    console.log(`📊 Top products: ${formatted.length} rows`);
    res.json(formatted);
  });
});

app.get("/api/analytics/customer-history/:id", (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (!Number.isFinite(customerId)) {
    console.warn(`⚠️ Invalid customer id: ${req.params.id}`);
    return res.status(400).json({ message: "Invalid customer id" });
  }
  console.log(`📊 Fetching customer history for ID: ${customerId}`);

  const sql = `
    SELECT ORDER_NO, ORDER_DATE, AMOUNT_US as amount, STATUS
    FROM TBL_ORDERS
    WHERE CUSTOMER_ID = ?
    ORDER BY ORDER_DATE DESC
  `;

  dbModule.all(sql, [customerId], (err, rows) => {
    if (err) {
      console.error("❌ Customer history error:", err.message);
      return res.status(500).json([]);
    }
    const formatted = rows.map((r) => ({
      ORDER_NO: r.ORDER_NO,
      ORDER_DATE: r.ORDER_DATE,
      amount: num(r.amount),
      STATUS: r.STATUS || "Pending",
    }));
    console.log(`📊 Customer history: ${formatted.length} orders`);
    res.json(formatted);
  });
});

app.get("/api/analytics/yearly-revenue", (req, res) => {
  console.log("📊 Fetching yearly revenue...");

  const sql = `
    SELECT
      DatePart('yyyy', ORDER_DATE) as year,
      SUM(AMOUNT_US) as revenue,
      COUNT(*) as orders
    FROM TBL_ORDERS
    GROUP BY DatePart('yyyy', ORDER_DATE)
    ORDER BY DatePart('yyyy', ORDER_DATE) ASC
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Yearly revenue error:", err.message);
      return res.status(500).json([]);
    }
    const formatted = rows.map((r) => ({
      year: String(r.year),
      revenue: num(r.revenue),
      orders: num(r.orders),
    }));
    console.log(`📊 Yearly revenue: ${formatted.length} years`);
    res.json(formatted);
  });
});

app.get("/api/analytics/summary", (req, res) => {
  console.log("📊 Fetching analytics summary...");

  const currentSql = `
    SELECT SUM(AMOUNT_US) as revenue, COUNT(*) as orders
    FROM TBL_ORDERS
    WHERE DatePart('m', ORDER_DATE) = DatePart('m', Date())
    AND DatePart('yyyy', ORDER_DATE) = DatePart('yyyy', Date())
  `;
  const previousSql = `
    SELECT SUM(AMOUNT_US) as revenue, COUNT(*) as orders
    FROM TBL_ORDERS
    WHERE DatePart('m', ORDER_DATE) = DatePart('m', DateAdd('m', -1, Date()))
    AND DatePart('yyyy', ORDER_DATE) = DatePart('yyyy', DateAdd('m', -1, Date()))
  `;
  const productsSql = `SELECT COUNT(*) as count FROM TBL_PRODUCTS WHERE STATUS = 'Active'`;

  let completed = 0;
  const total = 3;
  let currentRevenue = 0;
  let currentOrders = 0;
  let previousRevenue = 0;
  let previousOrders = 0;
  let totalProducts = 0;

  const finish = () => {
    completed++;
    if (completed !== total) return;

    res.json({
      totalRevenue: currentRevenue,
      totalOrders: currentOrders,
      totalProducts: totalProducts,
      averageOrderValue: currentOrders > 0 ? currentRevenue / currentOrders : 0,
      revenueGrowth: growthPct(currentRevenue, previousRevenue),
      orderGrowth: growthPct(currentOrders, previousOrders),
    });
  };

  dbModule.get(currentSql, [], (err, row) => {
    if (err) {
      console.error("❌ Analytics summary (current) error:", err.message);
    } else if (row) {
      currentRevenue = num(row.revenue);
      currentOrders = num(row.orders);
    }
    finish();
  });

  dbModule.get(previousSql, [], (err, row) => {
    if (err) {
      console.error("❌ Analytics summary (previous) error:", err.message);
    } else if (row) {
      previousRevenue = num(row.revenue);
      previousOrders = num(row.orders);
    }
    finish();
  });

  dbModule.get(productsSql, [], (err, row) => {
    if (err) {
      console.error("❌ Analytics summary (products) error:", err.message);
    } else if (row) {
      totalProducts = num(row.count);
    }
    finish();
  });
});

// ============================================
// REPORTS (for Analytics.jsx Reports tab)
// ============================================

app.get("/api/reports/monthly-sales", (req, res) => {
  console.log("📈 Building monthly sales report...");

  const sql = `
    SELECT
      DatePart('yyyy', o.ORDER_DATE) as year,
      DatePart('m', o.ORDER_DATE) as month,
      SUM(od.QTY_ORDER * od.PRICE) as revenue,
      COUNT(DISTINCT o.OR_ID) as orders,
      SUM(od.QTY_ORDER * (od.PRICE - p.BUYIN_PRICE)) as profit
    FROM TBL_ORDERS o
    INNER JOIN TBL_ORDERS_DETAILS od ON o.OR_ID = od.OR_ID
    INNER JOIN TBL_PRODUCTS p ON od.PRODUCT_ID = p.ID
    GROUP BY DatePart('yyyy', o.ORDER_DATE), DatePart('m', o.ORDER_DATE)
    ORDER BY DatePart('yyyy', o.ORDER_DATE) ASC, DatePart('m', o.ORDER_DATE) ASC
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Monthly sales report error:", err.message);
      return res.status(500).json([]);
    }
    res.json(
      rows.map((r) => ({
        month: `${MONTH_NAMES[(r.month || 1) - 1]} ${r.year || ""}`.trim(),
        revenue: num(r.revenue),
        orders: num(r.orders),
        profit: num(r.profit),
      }))
    );
  });
});

app.get("/api/reports/product-performance", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  console.log(`📈 Building product performance report (top ${limit})...`);

  const sql = `
    SELECT TOP ${limit}
      p.NAME_EN as name,
      SUM(od.QTY_ORDER) as sales,
      SUM(od.QTY_ORDER * od.PRICE) as revenue,
      SUM(od.QTY_ORDER * (od.PRICE - p.BUYIN_PRICE)) as profit
    FROM TBL_ORDERS_DETAILS od
    INNER JOIN TBL_PRODUCTS p ON od.PRODUCT_ID = p.ID
    GROUP BY p.NAME_EN
    ORDER BY SUM(od.QTY_ORDER) DESC
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Product performance report error:", err.message);
      return res.status(500).json([]);
    }
    res.json(
      rows.map((r) => ({
        name: r.name || "Unknown",
        sales: num(r.sales),
        revenue: num(r.revenue),
        profit: num(r.profit),
      }))
    );
  });
});

app.get("/api/reports/customer-analytics", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  console.log(`📈 Building customer analytics report (top ${limit})...`);

  const sql = `
    SELECT TOP ${limit}
      c.FIRST_NAME & ' ' & c.LAST_NAME as name,
      COUNT(o.OR_ID) as orders,
      SUM(o.AMOUNT_US) as totalSpent,
      MAX(o.ORDER_DATE) as lastOrder
    FROM TBL_CUSTOMERS c
    INNER JOIN TBL_ORDERS o ON c.ID = o.CUSTOMER_ID
    GROUP BY c.FIRST_NAME, c.LAST_NAME
    ORDER BY SUM(o.AMOUNT_US) DESC
  `;

  dbModule.all(sql, [], (err, rows) => {
    if (err) {
      console.error("❌ Customer analytics report error:", err.message);
      return res.status(500).json([]);
    }
    res.json(
      rows.map((r) => {
        const orders = num(r.orders);
        const totalSpent = num(r.totalSpent);
        return {
          name: (r.name || "Unknown").trim(),
          orders: orders,
          totalSpent: totalSpent,
          avgOrder: orders > 0 ? totalSpent / orders : 0,
          lastOrder: r.lastOrder,
        };
      })
    );
  });
});

app.get("/api/reports/revenue-summary", (req, res) => {
  console.log("📈 Building revenue summary report...");

  const currentSql = `
    SELECT SUM(AMOUNT_US) as revenue, COUNT(*) as orders
    FROM TBL_ORDERS
    WHERE ORDER_DATE >= DateAdd('d', -30, Date())
  `;
  const previousSql = `
    SELECT SUM(AMOUNT_US) as revenue, COUNT(*) as orders
    FROM TBL_ORDERS
    WHERE ORDER_DATE >= DateAdd('d', -60, Date()) AND ORDER_DATE < DateAdd('d', -30, Date())
  `;
  const customersCurrentSql = `
    SELECT COUNT(*) as count FROM TBL_CUSTOMERS 
    WHERE CREATED_DA >= DateAdd('d', -30, Date())
  `;
  const customersPreviousSql = `
    SELECT COUNT(*) as count FROM TBL_CUSTOMERS
    WHERE CREATED_DA >= DateAdd('d', -60, Date()) AND CREATED_DA < DateAdd('d', -30, Date())
  `;
  const totalCustomersSql = `SELECT COUNT(*) as count FROM TBL_CUSTOMERS`;

  let completed = 0;
  const total = 5;
  let currentRevenue = 0;
  let currentOrders = 0;
  let previousRevenue = 0;
  let previousOrders = 0;
  let custCurrentCount = 0;
  let custPreviousCount = 0;
  let totalCustomers = 0;

  const finish = () => {
    completed++;
    if (completed !== total) return;

    res.json({
      totalRevenue: currentRevenue,
      totalOrders: currentOrders,
      totalCustomers: totalCustomers,
      avgOrderValue: currentOrders > 0 ? currentRevenue / currentOrders : 0,
      revenueGrowth: growthPct(currentRevenue, previousRevenue),
      orderGrowth: growthPct(currentOrders, previousOrders),
      customerGrowth: growthPct(custCurrentCount, custPreviousCount),
    });
  };

  dbModule.get(currentSql, [], (err, row) => {
    if (err) console.error("❌ Revenue summary current error:", err.message);
    else if (row) {
      currentRevenue = num(row.revenue);
      currentOrders = num(row.orders);
    }
    finish();
  });

  dbModule.get(previousSql, [], (err, row) => {
    if (err) console.error("❌ Revenue summary previous error:", err.message);
    else if (row) {
      previousRevenue = num(row.revenue);
      previousOrders = num(row.orders);
    }
    finish();
  });

  dbModule.get(customersCurrentSql, [], (err, row) => {
    if (err) console.error("❌ Customers current error:", err.message);
    else if (row) custCurrentCount = num(row.count);
    finish();
  });

  dbModule.get(customersPreviousSql, [], (err, row) => {
    if (err) console.error("❌ Customers previous error:", err.message);
    else if (row) custPreviousCount = num(row.count);
    finish();
  });

  dbModule.get(totalCustomersSql, [], (err, row) => {
    if (err) console.error("❌ Total customers error:", err.message);
    else if (row) totalCustomers = num(row.count);
    finish();
  });
});

// ============================================
// USER MANAGEMENT
// ============================================

app.get("/api/users", (req, res) => {
  console.log("👥 Fetching users...");

  dbModule.all(
    "SELECT UserID, Username, FullName, Role, Status, CreatedAt FROM Tbl_Users",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ Users error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      if (!rows || rows.length === 0) {
        console.log("⚠️ No users found");
        return res.json([]);
      }

      const mappedUsers = rows.map((user) => ({
        user_id: user.UserID,
        username: user.Username || "",
        fullname: user.FullName || "",
        role: user.Role || "Cashier",
        role_id: user.Role === "Admin" ? 1 : user.Role === "Cashier" ? 2 : 3,
        status: user.Status || "ACTIVE",
        last_login: user.CreatedAt || null,
      }));

      console.log(`✅ Found ${mappedUsers.length} users`);
      res.json(mappedUsers);
    }
  );
});

app.post("/api/users", (req, res) => {
  console.log("📝 Request body:", req.body);

  const { username, password, fullname, role_id } = req.body;

  if (!username || !password) {
    console.log("❌ Missing username or password");
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  const roleMap = { 1: "Admin", 2: "Cashier", 3: "Viewer" };
  const role = roleMap[String(role_id)] || "Cashier";

  const safeUsername = username.replace(/'/g, "''");
  const safePassword = password.replace(/'/g, "''");
  const safeFullname = (fullname || username).replace(/'/g, "''");

  dbModule.get(
    `SELECT UserID FROM Tbl_Users WHERE Username = '${safeUsername}'`,
    [],
    (err, existing) => {
      if (err) {
        console.error("❌ Check user error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      if (existing) {
        return res.status(400).json({ error: "Username already exists" });
      }

      const sql = `
        INSERT INTO Tbl_Users (Username, Password, FullName, Role, Status) 
        VALUES ('${safeUsername}', '${safePassword}', '${safeFullname}', '${role}', 'ACTIVE')
      `;

      console.log("📝 SQL:", sql);

      dbModule.run(sql, [], function (err) {
        if (err) {
          console.error("❌ Create user error:", err.message);
          return res.status(500).json({ error: err.message });
        }

        console.log("✅ User created with ID:", this.lastID);
        logActivity(
          req.body.user_id || 1,
          "Created user",
          "Tbl_Users",
          this.lastID
        );
        res.json({
          user_id: this.lastID,
          message: "User created successfully",
        });
      });
    }
  );
});

app.put("/api/users/:id", (req, res) => {
  const { id } = req.params;
  const { username, password, fullname, role_id } = req.body;

  console.log("📝 Updating user ID:", id, req.body);

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  const roleMap = { 1: "Admin", 2: "Cashier", 3: "Viewer" };
  const role = roleMap[String(role_id)] || "Cashier";

  const safeUsername = username.replace(/'/g, "''");
  const safeFullname = (fullname || username).replace(/'/g, "''");

  dbModule.get(
    `SELECT UserID FROM Tbl_Users WHERE Username = '${safeUsername}' AND UserID != ${id}`,
    [],
    (err, existing) => {
      if (err) {
        console.error("❌ Check user error:", err.message);
        return res.status(500).json({ error: err.message });
      }

      if (existing) {
        return res.status(400).json({ error: "Username already exists" });
      }

      let sql = `
        UPDATE Tbl_Users 
        SET Username = '${safeUsername}', 
            FullName = '${safeFullname}', 
            Role = '${role}'
      `;

      if (password && password.trim() !== "") {
        const safePassword = password.replace(/'/g, "''");
        sql += `, Password = '${safePassword}'`;
      }

      sql += ` WHERE UserID = ${id}`;

      console.log("📝 SQL:", sql);

      dbModule.run(sql, [], function (err) {
        if (err) {
          console.error("❌ Update user error:", err.message);
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        console.log("✅ User updated, ID:", id);
        logActivity(req.body.user_id || 1, "Updated user", "Tbl_Users", id);
        res.json({ message: "User updated successfully" });
      });
    }
  );
});

app.delete("/api/users/:id", (req, res) => {
  const { id } = req.params;

  console.log("🗑️ Deleting user ID:", id);

  if (id == 1) {
    return res.status(400).json({ error: "Cannot delete the main admin user" });
  }

  dbModule.run(
    `DELETE FROM Tbl_Users WHERE UserID = ${id}`,
    [],
    function (err) {
      if (err) {
        console.error("❌ Delete user error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      console.log("✅ User deleted, ID:", id);
      logActivity(req.body.user_id || 1, "Deleted user", "Tbl_Users", id);
      res.json({ message: "User deleted successfully" });
    }
  );
});

// ============================================
// WARRANTY API
// ============================================

app.get("/api/warranty", (req, res) => {
  console.log("🛡️ Fetching warranty records...");

  dbModule.all(
    "SELECT * FROM Tbl_Warranty ORDER BY WarrantyID DESC",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ Warranty error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`🛡️ Warranty records found: ${rows.length}`);
      res.json(rows);
    }
  );
});

app.post("/api/warranty", (req, res) => {
  const {
    CustomerID,
    ProductID,
    SerialNumber,
    WarrantyPeriod,
    WarrantyStartDate,
  } = req.body;

  const startDate = new Date(WarrantyStartDate);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + Number(WarrantyPeriod || 12));

  const sql = `
    INSERT INTO Tbl_Warranty (
      CustomerID, ProductID, SerialNumber, WarrantyPeriod, 
      WarrantyStartDate, WarrantyEndDate, Status
    ) VALUES (
      '${CustomerID}', 
      '${ProductID}', 
      '${(SerialNumber || "").replace(/'/g, "''")}', 
      ${Number(WarrantyPeriod) || 12},
      '${WarrantyStartDate}', 
      '${endDate.toISOString().split("T")[0]}',
      'Active'
    )
  `;

  dbModule.run(sql, [], function (err) {
    if (err) {
      console.error("❌ Create warranty error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({
      warranty_id: this.lastID,
      message: "Warranty created successfully",
    });
  });
});

// ============================================
// SERVICE REQUESTS API
// ============================================

app.get("/api/services", (req, res) => {
  console.log("🔧 Fetching service requests...");

  dbModule.all(
    "SELECT * FROM Tbl_Service_Requests ORDER BY ServiceID DESC",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ Services error:", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`🔧 Service requests found: ${rows.length}`);
      res.json(rows);
    }
  );
});

app.post("/api/services", (req, res) => {
  const {
    CustomerID,
    ProductID,
    SerialNumber,
    WarrantyID,
    IssueDescription,
    ServiceType,
    Status,
    EstimatedCost,
  } = req.body;

  const serviceNo = `SRV-${Date.now()}`;

  const sql = `
    INSERT INTO Tbl_Service_Requests (
      ServiceNo, CustomerID, ProductID, SerialNumber, WarrantyID,
      IssueDescription, ServiceType, Status, ReceivedDate, EstimatedCost
    ) VALUES (
      '${serviceNo}', 
      '${CustomerID}', 
      '${ProductID}', 
      '${(SerialNumber || "").replace(/'/g, "''")}', 
      '${WarrantyID || "NULL"}',
      '${(IssueDescription || "").replace(/'/g, "''")}', 
      '${ServiceType || "Repair"}', 
      '${Status || "PENDING"}', 
      Date(), 
      ${Number(EstimatedCost) || 0}
    )
  `;

  dbModule.run(sql, [], function (err) {
    if (err) {
      console.error("❌ Create service error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({
      service_id: this.lastID,
      message: "Service request created successfully",
    });
  });
});

// ============================================
// PAYMENT API
// ============================================

app.post("/api/payments/create-payment-intent", async (req, res) => {
  const { amount, orderId } = req.body;
  res.json({
    clientSecret: "mock_secret_" + Date.now(),
    message: "Payment intent created (mock)",
  });
});

app.post("/api/payments/record", (req, res) => {
  const { OR_ID, AMOUNT_US, AMOUNT_KH, REFERENCE_I, EMP_ID } = req.body;

  const sql = `
    INSERT INTO TBL_PAYMENT (
      OR_ID,
      AMOUNT_US,
      AMOUNT_KH,
      PAY_DATE,
      STATUS
    ) VALUES (
      ${Number(OR_ID)},
      ${AMOUNT_US || 0},
      ${AMOUNT_KH || 0},
      Date(),
      'COMPLETED'
    )
  `;

  dbModule.run(sql, [], function (err) {
    if (err) {
      console.error("❌ Payment record error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Payment recorded" });
  });
});

// ============================================
// PURCHASE
// ============================================
app.post("/api/purchase", (req, res) => {
  const {
    CUSTOMER_ID,
    items,
    DISCOUNT = 0,
    STATUS = "Pending",
    EMP_PREPARE = 1,
    NOTES = "",
  } = req.body;

  console.log("📦 Processing purchase order...");
  console.log("📦 Customer ID:", CUSTOMER_ID);
  console.log("📦 Items:", items);

  if (!CUSTOMER_ID) {
    return res.status(400).json({ error: "Customer ID is required" });
  }
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "At least one item is required" });
  }

  const customerIdText = String(CUSTOMER_ID);
  const findCustomerSql = `SELECT ID, CUS_ID FROM TBL_CUSTOMERS WHERE CUS_ID = '${customerIdText}'`;
  console.log("🔍 SQL:", findCustomerSql);

  dbModule.get(findCustomerSql, [], (err, customer) => {
    if (err) {
      console.error("❌ Customer check error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!customer) {
      console.error("❌ Customer not found:", CUSTOMER_ID);
      return res.status(400).json({
        error: `Customer with ID ${CUSTOMER_ID} not found`,
      });
    }

    const numericCustomerId = customer.ID;
    console.log(
      `✅ Customer found: ${customer.CUS_ID} with numeric ID: ${numericCustomerId}`
    );

    let productCheckCompleted = 0;
    const totalItems = items.length;
    let hasError = false;
    let errorMessages = [];
    const productIdMap = {};

    if (totalItems === 0) {
      return res.status(400).json({ error: "No items to process" });
    }

    items.forEach((item) => {
      const productIdText = String(item.product_id || "");

      if (
        !productIdText ||
        productIdText === "null" ||
        productIdText === "undefined" ||
        productIdText === ""
      ) {
        errorMessages.push(`Invalid product ID: ${productIdText}`);
        hasError = true;
        productCheckCompleted++;
        if (productCheckCompleted === totalItems) {
          if (hasError) {
            return res.status(400).json({
              error: "Invalid product IDs found",
              details: errorMessages,
            });
          }
          proceedWithOrder();
        }
        return;
      }

      const checkProductSql = `SELECT ID, PRODUCT_ID FROM TBL_PRODUCTS WHERE PRODUCT_ID = '${productIdText}'`;
      console.log("🔍 SQL:", checkProductSql);

      dbModule.get(checkProductSql, [], (err, product) => {
        if (err) {
          console.error("❌ Product check error:", err.message);
          hasError = true;
          errorMessages.push(
            `Error checking product ${productIdText}: ${err.message}`
          );
        } else if (!product) {
          console.error("❌ Product not found:", productIdText);
          hasError = true;
          errorMessages.push(`Product with ID ${productIdText} not found`);
        } else {
          productIdMap[productIdText] = product.ID;
          console.log(
            `✅ Product found: ${product.PRODUCT_ID} with numeric ID: ${product.ID}`
          );
        }

        productCheckCompleted++;
        if (productCheckCompleted === totalItems) {
          if (hasError) {
            return res.status(400).json({
              error: "Product validation failed",
              details: errorMessages,
            });
          }
          proceedWithOrder();
        }
      });
    });

    function proceedWithOrder() {
      dbModule.serialize(() => {
        const orderNo = `PO-${Date.now()}`;
        let totalAmount = 0;
        let discountAmount = 0;

        items.forEach((item) => {
          const qty = Number(item.qty) || 0;
          const price = Number(item.unit_price) || 0;
          const discount = Number(item.discount) || 0;
          totalAmount += qty * price - discount;
        });

        discountAmount = Number(DISCOUNT) || 0;
        totalAmount = Math.max(0, totalAmount - discountAmount);

        const orderSql = `
          INSERT INTO TBL_ORDERS (
            ORDER_NO, 
            CUSTOMER_ID, 
            ORDER_DATE, 
            AMOUNT_US, 
            STATUS,
            EMP_PREPARE,
            DISCOUNT,
            NOTES
          ) VALUES (
            '${orderNo}',
            ${numericCustomerId},
            Date(),
            ${totalAmount},
            '${STATUS}',
            ${EMP_PREPARE},
            ${discountAmount},
            '${(NOTES || "").replace(/'/g, "''")}'
          )
        `;

        console.log("📝 SQL:", orderSql);

        dbModule.run(orderSql, [], function (err) {
          if (err) {
            console.error("❌ Order creation error:", err.message);
            return res.status(500).json({
              error: "Failed to create order",
              details: err.message,
            });
          }

          const orderId = this.lastID;
          console.log(`✅ Order created: ${orderNo} (ID: ${orderId})`);
          processItems(orderId);
        });

        function processItems(orderId) {
          let completed = 0;
          const totalItemsCount = items.length;

          if (totalItemsCount === 0) {
            return res.json({
              success: true,
              order_no: orderNo,
              order_id: orderId,
              message: "Order created with no items",
            });
          }

          items.forEach((item) => {
            const productIdText = String(item.product_id || "");
            const qty = Number(item.qty) || 0;
            const price = Number(item.unit_price) || 0;
            const discount = Number(item.discount) || 0;
            const subtotal = qty * price - discount;

            if (
              !productIdText ||
              productIdText === "null" ||
              productIdText === "undefined" ||
              productIdText === ""
            ) {
              console.warn("⚠️ Skipping item with invalid product ID");
              completed++;
              if (completed === totalItemsCount) {
                res.json({
                  success: true,
                  order_no: orderNo,
                  order_id: orderId,
                  message: "Order created with warnings",
                });
              }
              return;
            }

            const numericProductId = productIdMap[productIdText];
            if (!numericProductId) {
              console.warn(`⚠️ Product ${productIdText} not found in map`);
              completed++;
              if (completed === totalItemsCount) {
                res.json({
                  success: true,
                  order_no: orderNo,
                  order_id: orderId,
                  message: "Order created with warnings",
                });
              }
              return;
            }

            const detailSql = `
              INSERT INTO TBL_ORDERS_DETAILS (
                OR_ID,
                PRODUCT_ID,
                QTY_ORDER,
                PRICE,
                SUBTOTAL
              ) VALUES (
                ${orderId},
                ${numericProductId},
                ${qty},
                ${price},
                ${subtotal}
              )
            `;

            console.log("📝 Detail SQL:", detailSql);

            dbModule.run(detailSql, [], function (err) {
              if (err) {
                console.error("❌ Order detail error:", err.message);
              }

              const stockSql = `
                UPDATE Tbl_Stock 
                SET 
                  QtyAvailable = QtyAvailable - ${qty},
                  QtyInStock = QtyInStock - ${qty}
                WHERE ProductID = ${numericProductId}
              `;

              console.log("📝 Stock SQL:", stockSql);

              dbModule.run(stockSql, [], function (err) {
                if (err) {
                  console.warn("⚠️ Stock update error:", err.message);
                }
                completed++;
                if (completed === totalItemsCount) {
                  res.json({
                    success: true,
                    order_no: orderNo,
                    order_id: orderId,
                    message: "Order created successfully",
                    order: {
                      order_no: orderNo,
                      order_id: orderId,
                      customer_id: CUSTOMER_ID,
                      amount: totalAmount,
                      status: STATUS,
                    },
                  });
                }
              });
            });
          });
        }
      });
    }
  });
});

// ============================================
// GET TABLE STRUCTURE - DEBUG
// ============================================
app.get("/api/debug/table/:name", (req, res) => {
  const { name } = req.params;
  console.log(`🔍 Debugging table: ${name}`);

  const checkTableSql = `SELECT COUNT(*) as count FROM ${name}`;

  dbModule.get(checkTableSql, [], (err, countResult) => {
    if (err) {
      console.error("❌ Table not found or error:", err.message);

      const tablesSql = `
        SELECT Name 
        FROM MSysObjects 
        WHERE Type = 1 
        AND Flags = 0
        ORDER BY Name
      `;

      dbModule.all(tablesSql, [], (err2, tables) => {
        if (err2) {
          return res.status(404).json({
            error: `Table '${name}' not found`,
            message: err.message,
            available_tables: [],
          });
        }

        const tableNames = tables.map((t) => t.Name || t.name);
        return res.status(404).json({
          error: `Table '${name}' not found`,
          message: err.message,
          available_tables: tableNames || [],
          suggestion: "Check for case sensitivity and spelling",
        });
      });
      return;
    }

    const sampleSql = `SELECT * FROM ${name}`;

    dbModule.all(sampleSql, [], (err2, rows) => {
      if (err2) {
        console.error("❌ Error getting sample:", err2.message);
        return res.json({
          table: name,
          exists: true,
          message: "Table exists but could not get sample data",
          error: err2.message,
          rowCount: countResult.count || 0,
        });
      }

      if (!rows || rows.length === 0) {
        return res.json({
          table: name,
          exists: true,
          message: "Table exists but has no data",
          rowCount: 0,
          columns: [],
        });
      }

      const columns = Object.keys(rows[0]);
      console.log(`✅ Table '${name}' found with columns:`, columns);

      const limitedRows = rows.slice(0, 100);

      res.json({
        table: name,
        exists: true,
        columns: columns,
        sample: rows[0],
        rowCount: countResult.count || 0,
        data: limitedRows,
      });
    });
  });
});

// ============================================
// TEST
// ============================================

app.get("/api/test", (req, res) => {
  dbModule.get("SELECT 1 as test", [], (err, result) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true, result });
  });
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
  console.log("🔄 Initializing database connection...");

  const conn = await dbModule.initDatabase();

  if (!conn) {
    console.error("❌ Failed to connect to database. Exiting...");
    process.exit(1);
  }

  console.log("✅ Database connection established!");

  // Only start server locally, not on Vercel
  const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  
  if (!isVercel) {
    app.listen(PORT, () => {
      console.log("🚀 SPMS Backend running on http://localhost:" + PORT);
      console.log("📊 Test API: http://localhost:" + PORT + "/api/test");
      console.log("📁 Connected to Access database successfully!");
      console.log("");
      console.log("📋 Available Endpoints:");
      console.log("  🔐 Auth:          POST /api/auth/login");
      console.log("  👥 Customers:     GET/POST /api/customers");
      console.log("  📦 Products:      GET/POST /api/products");
      console.log("  🛒 Orders:        GET /api/orders");
      console.log("  📋 Order:         GET /api/orders/:id (details)");
      console.log("  💳 Payments:      GET /api/payment-methods");
      console.log("  💰 Payment:       POST /api/payments/record");
      console.log("  📊 Stock:         GET /api/stock");
      console.log("  📊 Stock Product: GET /api/stock/product/:id");
      console.log("  💳 Purchase:      POST /api/purchase");
      console.log("  📋 Reports:       GET /api/reports/*");
      console.log("  👤 Users:         GET /api/users");
      console.log("  📝 Activity:      GET /api/activity-logs");
      console.log("  🛡️ Warranty:      GET /api/warranty");
      console.log("  🔧 Services:      GET /api/services");
      console.log("  📊 Analytics:     GET /api/analytics/*");
      console.log("  🔍 Debug:         GET /api/debug/table/:name");
    });
  }
}

startServer().catch((err) => {
  console.error("❌ Server startup failed:", err.message);
  process.exit(1);
});

// ============================================
// EXPORT for Vercel (Serverless)
// ============================================
// This must be at the top level, not inside any condition
module.exports = app;