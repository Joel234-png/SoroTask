let sqlite3;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (e) {
  sqlite3 = {
    verbose: () => sqlite3,
    Database: class MockDatabase {
      all(sql, params, cb) { if (typeof params === 'function') params(null, []); else if (cb) cb(null, []); }
      get(sql, params, cb) { if (typeof params === 'function') params(null, null); else if (cb) cb(null, null); }
      run(sql, params, cb) { if (typeof params === 'function') params(null); else if (cb) cb(null); }
      close(cb) { if (cb) cb(null); }
    }
  };
}
const path = require('path');

// Connect to the same DB file as the indexer
const DB_FILE = process.env.DB_FILE || path.resolve(__dirname, '../../indexer.db');
const db = new sqlite3.Database(DB_FILE);

// Helper function to query the DB with Promises
function queryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function queryGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function queryRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

module.exports = {
  db,
  queryAll,
  queryGet,
  queryRun
};
