#!/bin/bash
cd /root
git pull origin main >> /root/deploy.log 2>&1
npm install --production >> /root/deploy.log 2>&1
/usr/bin/pm2 restart clutch-web >> /root/deploy.log 2>&1
/usr/bin/pm2 restart clutch-bot >> /root/deploy.log 2>&1
echo "$(date) Deploy completado" >> /root/deploy.log
