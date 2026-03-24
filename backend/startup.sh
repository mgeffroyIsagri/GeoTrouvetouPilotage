#!/bin/bash
# Startup script pour Azure App Service (Linux)
cd /home/site/wwwroot
gunicorn -w 2 -k uvicorn.workers.UvicornWorker main:app \
  --bind 0.0.0.0:8000 \
  --timeout 120 \
  --access-logfile '-' \
  --error-logfile '-'
