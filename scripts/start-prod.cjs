// Production entry point (B8): nothing used to set NODE_ENV=production, so the
// app always booted with development defaults (dev JWT secret, admin password
// allowed to stay "Admin123!", payout batcher draining outside the window).
// Setting it here — before dist/main.js (and therefore config.ts) is loaded —
// flips all of those production-aware defaults on. Cross-platform: no cross-env.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
require('../dist/main.js');
