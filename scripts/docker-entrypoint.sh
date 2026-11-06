#!/bin/sh
set -eu
npm run deploy:check
npm run db:migrate
npm run db:seed
exec npm run start -- --hostname 0.0.0.0
