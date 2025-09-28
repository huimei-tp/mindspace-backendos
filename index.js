
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { nvidiaService } = require('./nvidiaService');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'minds_app',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: true,
  },
});

// ------------------- API Routes -------------------

// ------------------- AUTH & USER -------------------

app.get('/api/hello', (req, res) => {
  res.json({ message: 'welcome to mindspace' });
});

// Register new user
app.post('/api/users/register', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      name,
      email,
      password,
      myChild,
      sessionCountPerWeek,
      convenientTimes,
      interestedSupport
    } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'name, email, password required' });
    }

    // Insert into users
    const [userResult] = await conn.query(
      'INSERT INTO users (id, name, email, password, session_count_per_week, convenient_times, interested_support) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, name, email, password, sessionCountPerWeek, JSON.stringify(convenientTimes || []),
        JSON.stringify(interestedSupport || [])]
    );
    const userId = userResult.insertId;

    // Insert child if present
    if (myChild) {
      const dob = new Date(myChild.dob);
      const mysqlDate = dob.toISOString().slice(0, 19).replace('T', ' ');
      await conn.query(
        'INSERT INTO children (id, user_id, name, dob, gender, condition_text) VALUES (?, ?, ?, ?, ?, ?)',
        [
          email + myChild.name,
          email,
          myChild.name || null,
          mysqlDate || null,
          myChild.gender || null,
          myChild.condition || null
        ]
      );
    }
    await conn.commit();
    console.log('Registered user:', userResult);
    res.json({ message: 'success' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'error' });
  } finally {
    conn.release();
  }
});


// ------------------- ENTRIES -------------------

// Add energy entry
app.post('/api/users/:id/energy', async (req, res) => {
  try {
    const userId = req.params.id;
    const { score, notes, date } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const [result] = await pool.query(
      'INSERT INTO energy_entries (user_id, score, notes, date) VALUES (?, ?, ?, ?)',
      [userId, score || null, notes || null, date]
    );
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Add mood entry
app.post('/api/users/:id/mood', async (req, res) => {
  try {
    const userId = req.params.id;
    const { mood, date } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const [result] = await pool.query(
      'INSERT INTO mood_entries (user_id, mood, entry_date) VALUES (?, ?, ?)',
      [userId, mood || null, date || null]
    );
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get moods for a user
app.get('/api/users/:id/moods', async (req, res) => {
  try {
    const userId = req.params.id;
    const [rows] = await pool.query(
      'SELECT entry_date, mood FROM mood_entries WHERE user_id = ? ORDER BY entry_date DESC',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// Add reflection entry
app.post('/api/users/:id/reflection', async (req, res) => {
  try {
    const userId = req.params.id;
    const { high_text, low_text, entry_date } = req.body;
    if (!entry_date) return res.status(400).json({ error: 'entry_date required' });
    const [result] = await pool.query(
      'INSERT INTO reflection_entries (user_id, entry_date, high_text, low_text) VALUES (?, ?, ?, ?)',
      [userId, entry_date, high_text || null, low_text || null]
    );
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Add sleep entry
app.post('/api/users/:id/sleep', async (req, res) => {
  try {
    const userId = req.params.id;
    const { hoursSlept, minutesSlept, date } = req.body;
    if (!date) return res.status(400).json({ error: 'entry_date required' });
    const [result] = await pool.query(
      'INSERT INTO sleep_entries (user_id, hours_slept, minutes_slept, entry_date) VALUES (?, ?, ?, ?)',
      [userId, hoursSlept || null, minutesSlept || null, date]
    );
    res.json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Update sleep entry
app.put('/api/users/:id/sleep/:entryId', async (req, res) => {
  try {
    const userId = req.params.id;
    const entryId = req.params.entryId;
    const { hoursSlept, minutesSlept } = req.body;

    // Nothing to update?
    if (!hoursSlept && !minutesSlept && !entryId) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const [result] = await pool.query(
      'UPDATE sleep_entries SET hours_slept = ?, minutes_slept = ? WHERE entry_date = ? AND user_id = ?',
      [hoursSlept || null, minutesSlept || null, entryId || null, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// ------------------- EVENTS -------------------

// Register a user to an event
app.post('/api/users/:id/events/:eventId', async (req, res) => {
  try {
    const userId = req.params.id;
    const eventId = req.params.eventId;
    await pool.query(
      'INSERT INTO event_attendees (user_id, event_id) VALUES (?, ?)',
      [userId, eventId]
    );
    
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// ------------------- RESOURCES -------------------

// Retrieve activities (resources)
app.get('/api/resources/activities', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM activities ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Retrieve programs
app.get('/api/resources/programs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM programs WHERE active = 1 ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// Get all events
app.get('/api/events', async (req, res) => {
  try {
    const q =
      'SELECT id,title,type,description,address,date,time_label,CAST(longitude AS DOUBLE) AS longitude, CAST(latitude AS DOUBLE) AS latitude,image_url FROM events ORDER BY date ASC LIMIT 1000';
    const [rows] = await pool.query(q);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Get ALL users with child & entries
app.get('/api/users', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      // Fetch all users
      const [users] = await conn.query(
        'SELECT id, name, email, password, session_count_per_week, created_at FROM users'
      );

      // For each user, also fetch related data
      const results = await Promise.all(
        users.map(async (user) => {
          const [child] = await conn.query(
            'SELECT * FROM children WHERE user_id = ?',
            [user.id]
          );
          const [events] = await conn.query(
            `SELECT e.id,e.title,e.type,e.description,e.address,e.date,e.time_label,CAST(e.longitude AS DOUBLE) AS longitude, CAST(e.latitude AS DOUBLE) AS latitude,e.image_url  
             FROM events e 
             JOIN event_attendees ea ON e.id = ea.event_id 
             WHERE ea.user_id = ? 
             ORDER BY e.date ASC`,
            [user.id]
          );
          const [moods] = await conn.query(
            'SELECT * FROM mood_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 100',
            [user.id]
          );
          const [energies] = await conn.query(
            'SELECT * FROM energy_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 100',
            [user.id]
          );
          const [reflections] = await conn.query(
            'SELECT * FROM reflection_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 100',
            [user.id]
          );
          const [sleep] = await conn.query(
            'SELECT * FROM sleep_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 100',
            [user.id]
          );

          // Attach nested data directly to user
          user.child = child[0] || null;
          user.events = events;
          user.moods = moods;
          user.energies = energies;
          user.reflections = reflections;
          user.sleep = sleep;

          return user;
        })
      );

      res.json(results);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Add mood entry
app.post('/api/users/:id/moods', async (req, res) => {
  try {
    const userId = req.params.id;
    const { entry_date, mood } = req.body;
    if (!entry_date || mood == null)
      return res.status(400).json({ error: 'missing fields' });
    await pool.query(
      'INSERT INTO mood_entries (user_id, entry_date, mood) VALUES (?, ?, ?)',
      [userId, entry_date, mood]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Update mood entry
app.put('/api/users/:id/moods', async (req, res) => {
  try {
    const userId = req.params.id;
    const { entry_date, mood } = req.body;
    if (!entry_date || mood == null)
      return res.status(400).json({ error: 'missing fields' });

    const [result] = await pool.query(
      'UPDATE mood_entries SET mood = ? WHERE user_id = ? AND entry_date = ?',
      [mood, userId, entry_date]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'no entry found for given date' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// Add energy entry
app.post('/api/users/:id/energies', async (req, res) => {
  try {
    const userId = req.params.id;
    const { entry_date, morning, afternoon, night } = req.body;
    if (!entry_date)
      return res.status(400).json({ error: 'missing fields' });
    await pool.query(
      'INSERT INTO energy_entries (user_id, entry_date, morning, afternoon, night) VALUES (?, ?, ?, ?, ?)',
      [userId, entry_date, morning, afternoon, night]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Update only morning energy
app.put('/api/users/:id/energies/morning', async (req, res) => {
  try {
    const userId = req.params.id;
    const { entry_date, morning } = req.body;
    if (!entry_date || morning == null)
      return res.status(400).json({ error: 'missing fields' });

    await pool.query(
      'UPDATE energy_entries SET morning = ? WHERE user_id = ? AND entry_date = ?',
      [morning, userId, entry_date]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Update only afternoon energy
app.put('/api/users/:id/energies/afternoon', async (req, res) => {
  try {
    const userId = req.params.id;
    const { entry_date, afternoon } = req.body;
    if (!entry_date || afternoon == null)
      return res.status(400).json({ error: 'missing fields' });

    await pool.query(
      'UPDATE energy_entries SET afternoon = ? WHERE user_id = ? AND entry_date = ?',
      [afternoon, userId, entry_date]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Update only night energy
app.put('/api/users/:id/energies/night', async (req, res) => {
  try {
    const userId = req.params.id;
    const { entry_date, night } = req.body;
    if (!entry_date || night == null)
      return res.status(400).json({ error: 'missing fields' });

    await pool.query(
      'UPDATE energy_entries SET night = ? WHERE user_id = ? AND entry_date = ?',
      [night, userId, entry_date]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// Add reflection entry
app.post('/api/users/:id/reflections', async (req, res) => {
  try {
    console.log('Received reflection entry request:', req.body);
    console.debug('Request body:', req.body);
    const userId = req.params.id;
    const { entry_date, high_text, low_text } = req.body;
    if (!entry_date)
      return res.status(400).json({ error: 'missing fields' });
    await pool.query(
      'INSERT INTO reflection_entries (user_id, entry_date, high_text, low_text) VALUES (?, ?, ?, ?)',
      [userId, entry_date, high_text, low_text]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});


// Update reflection entry
app.put('/api/users/:id/reflections', async (req, res) => {
  console.log('Received reflection update request:', req.body);
  try {
    const userId = req.params.id;
    const { entry_date, high_text, low_text } = req.body;

    if (!entry_date) {
      return res.status(400).json({ error: 'missing fields' });
    }

    results = await pool.query(
      'UPDATE reflection_entries SET high_text = ?, low_text = ? WHERE user_id = ? AND entry_date = ?',
      [high_text || null, low_text || null, userId, entry_date]
    );
    console.log('Update results:', results);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// ------------------- AI FEATURES -------------------

// Moderation
app.post('/api/ai/moderate', async (req, res) => {
  try {
    const { text, type } = req.body;
    const result = await nvidiaService.moderateForumContent(text, type || 'post');
    res.json(result);
  } catch (err) {
    console.error('Moderation API error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Translation
app.post('/api/ai/translate', async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;
    const result = await nvidiaService.translateForumPost(text, targetLanguage);
    res.json(result);
  } catch (err) {
    console.error('Translation API error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Event Recommendations
app.post('/api/ai/recommend-events', async (req, res) => {
  try {
    const { childProfile, availableEvents, preferences } = req.body;
    const result = await nvidiaService.recommendEvents(childProfile, availableEvents, preferences);
    res.json(result);
  } catch (err) {
    console.error('Event Recommendation API error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Calendar Analysis & Breaks
app.post('/api/ai/analyze-calendar', async (req, res) => {
  try {
    const { calendarEvents, currentTime } = req.body;
    const result = await nvidiaService.analyzeCalendarAndRecommendBreaks(
      calendarEvents,
      currentTime ? new Date(currentTime) : new Date()
    );
    res.json(result);
  } catch (err) {
    console.error('Calendar Analysis API error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// Health check
app.get('/api/ai/health', async (req, res) => {
  try {
    const result = await nvidiaService.healthCheck();
    res.json(result);
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ------------------- Start Server -------------------
const port = 8080;
app.listen(port, () =>
  console.log(`API server running on port ${port}`)
);
