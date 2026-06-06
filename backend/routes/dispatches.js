const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { authenticateToken, isAgent, isAdmin } = require('../middleware/auth');

// Multer Setup for Image Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isVercel = process.env.VERCEL;
    const uploadDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'proof-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Upload failed: Only JPG/PNG images are allowed.'));
    }
  }
});

// GET /api/dispatches - Get all dispatches (supports pagination, search, filters)
router.get('/', authenticateToken, async (req, res) => {
  const { status, scheduled_date, agent_id, search, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  try {
    let sql = `
      SELECT d.*, a.name as agent_name, a.email as agent_email
      FROM dispatches d
      LEFT JOIN delivery_agents a ON d.agent_id = a.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Role restriction: Agents only see their assigned dispatches
    if (req.user.role === 'agent') {
      sql += ` AND d.agent_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    } else if (agent_id) {
      sql += ` AND d.agent_id = $${paramIndex}`;
      params.push(agent_id);
      paramIndex++;
    }

    if (status) {
      sql += ` AND d.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (scheduled_date) {
      sql += ` AND d.scheduled_date = $${paramIndex}`;
      params.push(scheduled_date);
      paramIndex++;
    }

    if (search) {
      sql += ` AND (d.order_id LIKE $${paramIndex} OR d.recipient_name LIKE $${paramIndex} OR d.delivery_address LIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Clone query for count
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) AS subquery`;
    const countParams = [...params];

    // Add ordering and pagination
    sql += ` ORDER BY d.last_updated DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const dataRes = await query(sql, params);
    const countRes = await query(countSql, countParams);

    const total = parseInt(countRes.rows[0].total || 0);

    res.json({
      dispatches: dataRes.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Fetch dispatches error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/dispatches/:id - Get dispatch detail with history logs
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const dispatchRes = await query(
      `SELECT d.*, a.name as agent_name, a.email as agent_email, a.phone as agent_phone
       FROM dispatches d
       LEFT JOIN delivery_agents a ON d.agent_id = a.id
       WHERE d.id = $1`,
      [id]
    );

    if (dispatchRes.rowCount === 0) {
      return res.status(404).json({ error: 'Dispatch record not found.' });
    }

    const dispatch = dispatchRes.rows[0];

    // Restrictions: Agents can only view their own dispatches
    if (req.user.role === 'agent' && dispatch.agent_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: Not assigned to this dispatch.' });
    }

    // Fetch history
    const historyRes = await query(
      `SELECT s.*, u.name as updated_by_name
       FROM status_updates s
       LEFT JOIN delivery_agents u ON s.updated_by = u.id
       WHERE s.dispatch_id = $1
       ORDER BY s.timestamp DESC`,
      [id]
    );

    // Fetch proof of delivery
    const proofRes = await query(
      `SELECT * FROM proof_of_delivery WHERE dispatch_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [id]
    );

    // Fetch failed attempts
    const failedRes = await query(
      `SELECT * FROM failed_attempts WHERE dispatch_id = $1 ORDER BY logged_at DESC`,
      [id]
    );

    res.json({
      dispatch,
      history: historyRes.rows,
      proof: proofRes.rows[0] || null,
      failedAttempts: failedRes.rows
    });
  } catch (error) {
    console.error('Fetch dispatch detail error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/dispatches - Create dispatch (Admin only)
router.post('/', authenticateToken, isAdmin, async (req, res) => {
  const { order_id, recipient_name, delivery_address, agent_id, scheduled_date, notes } = req.body;

  if (!order_id || !recipient_name || !delivery_address || !agent_id || !scheduled_date) {
    return res.status(400).json({ error: 'Required fields: order_id, recipient_name, delivery_address, agent_id, scheduled_date' });
  }

  try {
    // Check order_id uniqueness
    const duplicateCheck = await query('SELECT id FROM dispatches WHERE order_id = $1', [order_id]);
    if (duplicateCheck.rowCount > 0) {
      return res.status(400).json({ error: `Order ID '${order_id}' already exists.` });
    }

    // Insert dispatch
    const insertRes = await query(
      `INSERT INTO dispatches (order_id, recipient_name, delivery_address, agent_id, scheduled_date, status, notes, last_updated)
       VALUES ($1, $2, $3, $4, $5, 'Created', $6, CURRENT_TIMESTAMP) RETURNING id`,
      [order_id, recipient_name, delivery_address, agent_id, scheduled_date, notes]
    );
    const newId = insertRes.rows[0].id;

    // Create status log
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by)
       VALUES ($1, 'Created', 'Dispatch record created and agent assigned.', $2)`,
      [newId, req.user.id]
    );

    res.status(201).json({ message: 'Dispatch created successfully', id: newId });
  } catch (error) {
    console.error('Create dispatch error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// PUT /api/dispatches/:id/status - Update dispatch status & trigger upload/failed logging if applicable
router.put('/:id/status', authenticateToken, isAgent, (req, res) => {
  // We use Multer to parse potential multipart form uploads for proof photos
  upload.single('proof_photo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const { id } = req.params;
    const { status, notes, reason, retry_date } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status field is required.' });
    }

    try {
      // Get current dispatch
      const dispatchRes = await query('SELECT status, agent_id FROM dispatches WHERE id = $1', [id]);
      if (dispatchRes.rowCount === 0) {
        return res.status(404).json({ error: 'Dispatch record not found.' });
      }

      const dispatch = dispatchRes.rows[0];

      // Agent constraint: can only update their own dispatches
      if (req.user.role === 'agent' && dispatch.agent_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: Not assigned to this dispatch.' });
      }

      // Check Status Flow Rules: Created -> Picked Up -> Out For Delivery -> Delivered / Failed
      const current = dispatch.status;
      const next = status;
      let isTransitionValid = false;

      if (current === 'Created' && next === 'Picked Up') {
        isTransitionValid = true;
      } else if (current === 'Picked Up' && next === 'Out For Delivery') {
        isTransitionValid = true;
      } else if (current === 'Out For Delivery' && (next === 'Delivered' || next === 'Failed')) {
        isTransitionValid = true;
      } else if (current === 'Failed' && (next === 'Created' || next === 'Picked Up')) {
        // Admin or Agent re-attempt transition
        isTransitionValid = true;
      }

      if (!isTransitionValid) {
        return res.status(400).json({
          error: `Invalid status transition: Cannot transition from '${current}' directly to '${next}'. Status flow must be: Created ➔ Picked Up ➔ Out For Delivery ➔ Delivered / Failed.`
        });
      }

      // Delivered Rules: requires proof photo
      if (next === 'Delivered' && !req.file) {
        // Double check if there's already proof (e.g. uploaded previously)
        const proofCheck = await query('SELECT id FROM proof_of_delivery WHERE dispatch_id = $1', [id]);
        if (proofCheck.rowCount === 0) {
          return res.status(400).json({ error: 'Delivered status requires uploading a proof-of-delivery photo.' });
        }
      }

      // Failed Rules: requires failure reason, notes, future retry date
      if (next === 'Failed') {
        if (!reason) {
          return res.status(400).json({ error: 'Failed status requires a failure reason (e.g., Recipient Unavailable).' });
        }
        if (retry_date) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const retry = new Date(retry_date);
          if (retry <= today) {
            return res.status(400).json({ error: 'Retry date must be a future date.' });
          }
        }
      }

      // Process DB updates in sequence
      // 1. Update Dispatch Status and Last Updated
      // For sqlite compatibility we can update scheduled_date as well if it's a re-attempt
      let updateSql = `UPDATE dispatches SET status = $1, last_updated = CURRENT_TIMESTAMP`;
      const updateParams = [next];
      
      if (next === 'Created' || next === 'Picked Up') {
        // If re-attempting from failed state, optionally advance scheduled_date if provided
        if (retry_date) {
          updateSql += `, scheduled_date = $2`;
          updateParams.push(retry_date);
        }
      }
      updateSql += ` WHERE id = $${updateParams.length + 1}`;
      updateParams.push(id);

      await query(updateSql, updateParams);

      // 2. Insert Status Update log
      let statusNotes = notes || `Status updated from ${current} to ${next}.`;
      if (next === 'Failed') {
        statusNotes = `Failed attempt: ${reason}. Notes: ${notes || 'None'}`;
      } else if (next === 'Delivered') {
        statusNotes = `Delivery confirmed. Proof photo uploaded. ${notes || ''}`;
      }

      await query(
        `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
        [id, next, statusNotes, req.user.id]
      );

      // 3. Create Proof of Delivery record if photo uploaded
      if (req.file) {
        const imageUrl = `/uploads/${req.file.filename}`;
        // Delete previous proof if exists
        await query('DELETE FROM proof_of_delivery WHERE dispatch_id = $1', [id]);
        await query(
          `INSERT INTO proof_of_delivery (dispatch_id, image_url) VALUES ($1, $2)`,
          [id, imageUrl]
        );
      }

      // 4. Create Failed Attempt record if Failed
      if (next === 'Failed') {
        await query(
          `INSERT INTO failed_attempts (dispatch_id, reason, notes, retry_date) VALUES ($1, $2, $3, $4)`,
          [id, reason, notes || '', retry_date || null]
        );
      }

      res.json({ message: `Dispatch status updated successfully to '${next}'.` });
    } catch (error) {
      console.error('Update status error:', error);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });
});

module.exports = router;
