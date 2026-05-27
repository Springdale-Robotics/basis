# Deployment Guide

## Quick Start

```bash
cd backend
./install.sh
```

That's it. The installer will:
1. Check Docker is installed
2. Generate secure credentials
3. Start all services
4. Print a URL to complete setup

Open the URL in your browser to create your household and admin account.

## One-Liner Install (Remote)

```bash
curl -fsSL https://raw.githubusercontent.com/Springdale-Robotics/basis/main/backend/deploy/get-basis.sh | bash
```

> Note: this URL becomes reachable once the repo is public. For now, clone the
> repo locally and run `backend/install.sh` (Docker) or
> `sudo bash backend/deploy/native/install.sh --source $(pwd)` (native).

---

## Environment Variables

Create `.env` with these required values:

```bash
# Database
DATABASE_URL=postgres://homemanager:YOUR_PASSWORD@postgres:5432/homemanager

# Redis
REDIS_URL=redis://redis:6379

# Security (CHANGE THESE!)
SESSION_SECRET=generate-at-least-32-random-characters-here
ENCRYPTION_KEY=generate-64-hex-characters-here

# Server
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://your-domain.com

# Storage
STORAGE_PATH=/data/storage
```

Generate secure values:
```bash
# Session secret (32+ chars)
openssl rand -base64 32

# Encryption key (64 hex chars)
openssl rand -hex 32
```

---

## Production Deployment

### 1. Server Setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Deploy Application

```bash
# Create app directory
sudo mkdir -p /opt/homemanager
cd /opt/homemanager

# Copy files (or git clone)
# Place backend/ directory here

cd backend
cp .env.example .env
# Edit .env with production values

# Start services
docker-compose up -d

# Run migrations
docker-compose exec backend npm run db:migrate
```

### 3. Reverse Proxy (Choose One)

#### Option A: Caddy (Recommended - Auto HTTPS)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Copy config
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# Edit /etc/caddy/Caddyfile - replace your-domain.com

# Start Caddy
sudo systemctl enable caddy
sudo systemctl start caddy
```

#### Option B: Nginx

```bash
# Install Nginx
sudo apt install nginx

# Install certbot for SSL
sudo apt install certbot python3-certbot-nginx

# Copy config
sudo cp deploy/nginx.conf /etc/nginx/sites-available/homemanager
sudo ln -s /etc/nginx/sites-available/homemanager /etc/nginx/sites-enabled/
# Edit config - replace your-domain.com

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Restart Nginx
sudo systemctl restart nginx
```

### 4. Firewall

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## Development Setup

```bash
cd backend

# Start only database and Redis
docker-compose -f docker-compose.dev.yml up -d

# Install dependencies
npm install

# Copy env file
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgres://homemanager:devpassword@localhost:5432/homemanager
#   REDIS_URL=redis://localhost:6379

# Generate and run migrations
npm run db:generate
npm run db:migrate

# (Optional) Seed demo data
npm run db:seed

# Start dev server
npm run dev
```

Dev tools available:
- pgAdmin: http://localhost:5050 (admin@homemanager.local / admin)
- Redis Commander: http://localhost:8081

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run production server |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert demo data |
| `npm run db:studio` | Open Drizzle Studio (DB browser) |

---

## Backups

### Manual Backup

```bash
# Database
docker-compose exec postgres pg_dump -U homemanager homemanager > backup.sql

# Files
tar -czf storage-backup.tar.gz /var/lib/docker/volumes/backend_homemanager-storage/_data
```

### Restore

```bash
# Database
cat backup.sql | docker-compose exec -T postgres psql -U homemanager homemanager

# Files
tar -xzf storage-backup.tar.gz -C /
```

---

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

### Logs

```bash
# All services
docker-compose logs -f

# Backend only
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Resource Usage

```bash
docker stats
```

---

## Updating

```bash
cd /opt/homemanager/backend

# Pull latest code
git pull

# Rebuild and restart
docker-compose build
docker-compose up -d

# Run any new migrations
docker-compose exec backend npm run db:migrate
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs backend

# Common issues:
# - DATABASE_URL incorrect
# - Port 3000 already in use
# - Missing environment variables
```

### Database connection failed

```bash
# Verify postgres is running
docker-compose ps

# Test connection
docker-compose exec postgres psql -U homemanager -c "SELECT 1"
```

### Redis connection failed

```bash
# Verify redis is running
docker-compose exec redis redis-cli ping
```

### Reset everything

```bash
# Stop and remove containers, volumes
docker-compose down -v

# Start fresh
docker-compose up -d
docker-compose exec backend npm run db:migrate
docker-compose exec backend npm run db:seed
```
