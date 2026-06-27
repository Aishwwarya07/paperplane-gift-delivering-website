const bcrypt = require('bcryptjs');

const seed = async (clearFirst = true, customQuery = null) => {
  // Shadow imported query with local variable to resolve deadlock in serverless DB init
  const query = customQuery || require('./db').query;
  const { initDb } = require('./db');

  try {
    console.log('Starting database seeding...');

    // 1. Initialize schema
    if (!customQuery) {
      await initDb();
    }

    // 2. Clear tables (just in case)
    if (clearFirst) {
      await query('DELETE FROM failed_attempts');
      await query('DELETE FROM proof_of_delivery');
      await query('DELETE FROM status_updates');
      await query('DELETE FROM dispatches');
      await query('DELETE FROM delivery_agents');
    }

    // 3. Create password hashes
    const adminPasswordHash = await bcrypt.hash('adminpassword', 10);
    const agentPasswordHash = await bcrypt.hash('agentpassword', 10);

    console.log('Inserting delivery agents / admins...');
    
    // Insert admin
    const adminRes = await query(
      `INSERT INTO delivery_agents (name, email, password_hash, phone, role) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Paper Plane Admin', 'admin@paperplane.com', adminPasswordHash, '+15550100', 'admin']
    );
    const adminId = adminRes.rows[0].id;

    // Insert agents
    const agent1Res = await query(
      `INSERT INTO delivery_agents (name, email, password_hash, phone, role) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['John Doe', 'john@paperplane.com', agentPasswordHash, '+15550101', 'agent']
    );
    const agent1Id = agent1Res.rows[0].id;

    const agent2Res = await query(
      `INSERT INTO delivery_agents (name, email, password_hash, phone, role) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Sarah Connor', 'sarah@paperplane.com', agentPasswordHash, '+15550102', 'agent']
    );
    const agent2Id = agent2Res.rows[0].id;

    const agent3Res = await query(
      `INSERT INTO delivery_agents (name, email, password_hash, phone, role) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      ['Mike Ross', 'mike@paperplane.com', agentPasswordHash, '+15550103', 'agent']
    );
    const agent3Id = agent3Res.rows[0].id;

    console.log('Inserting dispatches...');

    // Dispatch 1: Created
    const d1 = await query(
      `INSERT INTO dispatches (order_id, recipient_name, delivery_address, agent_id, scheduled_date, status, notes, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
      ['ORD-2026-001', 'Alice Smith', '123 Elm St, Springfield', agent1Id, '2026-06-06', 'Created', 'Handle with care - fragile porcelain vase.']
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d1.rows[0].id, 'Created', 'Dispatch record created and agent assigned.', adminId]
    );

    // Dispatch 2: Picked Up
    const d2 = await query(
      `INSERT INTO dispatches (order_id, recipient_name, delivery_address, agent_id, scheduled_date, status, notes, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
      ['ORD-2026-002', 'Bob Johnson', '456 Oak Ave, Riverdale', agent2Id, '2026-06-06', 'Picked Up', 'Birthday gift wrap requested.']
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d2.rows[0].id, 'Created', 'Dispatch record created and agent assigned.', adminId]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d2.rows[0].id, 'Picked Up', 'Gift picked up from Paper Plane dispatch hub.', agent2Id]
    );

    // Dispatch 3: Out For Delivery
    const d3 = await query(
      `INSERT INTO dispatches (order_id, recipient_name, delivery_address, agent_id, scheduled_date, status, notes, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
      ['ORD-2026-003', 'Charlie Brown', '789 Pine Rd, Hill Valley', agent3Id, '2026-06-06', 'Out For Delivery', 'Call before arrival.']
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d3.rows[0].id, 'Created', 'Dispatch record created and agent assigned.', adminId]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d3.rows[0].id, 'Picked Up', 'Gift picked up from Paper Plane dispatch hub.', agent3Id]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d3.rows[0].id, 'Out For Delivery', 'Agent is en route to delivery address.', agent3Id]
    );

    // Dispatch 4: Delivered
    const d4 = await query(
      `INSERT INTO dispatches (order_id, recipient_name, delivery_address, agent_id, scheduled_date, status, notes, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
      ['ORD-2026-004', 'Diana Prince', '555 Gateway Blvd, Metropolis', agent1Id, '2026-06-05', 'Delivered', 'Leave with receptionist if unavailable.']
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d4.rows[0].id, 'Created', 'Dispatch record created.', adminId]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d4.rows[0].id, 'Picked Up', 'Gift picked up.', agent1Id]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d4.rows[0].id, 'Out For Delivery', 'Out for delivery.', agent1Id]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d4.rows[0].id, 'Delivered', 'Delivered to receptionist at front desk.', agent1Id]
    );
    // Create proof of delivery
    await query(
      `INSERT INTO proof_of_delivery (dispatch_id, image_url) VALUES ($1, $2)`,
      [d4.rows[0].id, '/uploads/sample-proof.png']
    );

    // Dispatch 5: Failed
    const d5 = await query(
      `INSERT INTO dispatches (order_id, recipient_name, delivery_address, agent_id, scheduled_date, status, notes, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
      ['ORD-2026-005', 'Evan Wright', '777 Lucky Ln, Las Vegas', agent2Id, '2026-06-05', 'Failed', 'Gate code is #1234.']
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d5.rows[0].id, 'Created', 'Dispatch record created.', adminId]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d5.rows[0].id, 'Picked Up', 'Gift picked up.', agent2Id]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d5.rows[0].id, 'Out For Delivery', 'Out for delivery.', agent2Id]
    );
    await query(
      `INSERT INTO status_updates (dispatch_id, status, notes, updated_by) VALUES ($1, $2, $3, $4)`,
      [d5.rows[0].id, 'Failed', 'Recipient unavailable at address.', agent2Id]
    );
    // Create failed attempt record
    await query(
      `INSERT INTO failed_attempts (dispatch_id, reason, notes, retry_date) VALUES ($1, $2, $3, $4)`,
      [d5.rows[0].id, 'Recipient Unavailable', 'Nobody answered the intercom or phone after three attempts.', '2026-06-08']
    );

    console.log('Seeding finished successfully.');
  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  }
};

module.exports = { seed };

if (require.main === module) {
  seed(true)
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      process.exit(1);
    });
}
