require('dotenv').config();
const express    = require('express');
const crypto     = require('crypto');
const { exec }   = require('child_process');

const app    = express();
const PORT   = 3002;
const SECRET = process.env.DEPLOY_SECRET || 'clutch-deploy-secret';

app.use(express.json());

app.post('/deploy', (req, res) => {
    const branch = req.body?.ref;
    if (branch && branch !== 'refs/heads/main') return res.status(200).send('Rama ignorada');

    res.status(200).send('Deploy iniciado');
    console.log('[deploy] Ejecutando deploy en /root...');

    const cmd = 'git pull origin main && npm install --production && /usr/bin/pm2 restart all';
    exec(cmd, {
        cwd: '/root',
        env: { ...process.env, HOME: '/root', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
    }, (err, stdout, stderr) => {
        if (err) {
            console.error('[deploy] ❌ Error:', err.message);
            console.error('[deploy] stderr:', stderr);
            console.error('[deploy] stdout:', stdout);
        } else {
            console.log('[deploy] ✅ Deploy completado:', stdout || '(sin output)');
        }
    });
});

app.get('/deploy', (req, res) => res.send('Clutch Deploy Server OK'));

app.listen(PORT, () => console.log(`[deploy] Servidor en puerto ${PORT}`));
