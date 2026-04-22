require('dotenv').config();
const express    = require('express');
const crypto     = require('crypto');
const { exec }   = require('child_process');

const app    = express();
const PORT   = 3002;
const SECRET = process.env.DEPLOY_SECRET || 'clutch-deploy-secret';

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.post('/deploy', (req, res) => {
    // Verificar firma de GitHub
    const sig = req.headers['x-hub-signature-256'];
    if (sig) {
        const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(req.rawBody).digest('hex');
        if (sig !== expected) return res.status(401).send('Firma inválida');
    }

    const branch = req.body?.ref;
    if (branch && branch !== 'refs/heads/main') return res.status(200).send('Rama ignorada');

    res.status(200).send('Deploy iniciado');

    exec('git pull origin main && npm install --production && pm2 restart all', {
        cwd: __dirname
    }, (err, stdout, stderr) => {
        if (err) {
            console.error('[deploy] Error:', err.message);
            console.error(stderr);
        } else {
            console.log('[deploy] ✅ Deploy completado:\n', stdout);
        }
    });
});

app.get('/deploy', (req, res) => res.send('Clutch Deploy Server OK'));

app.listen(PORT, () => console.log(`[deploy] Servidor en puerto ${PORT}`));
