# Deployment Guide for VPS

This guide will help you deploy the Bradd RDT application to a Virtual Private Server (VPS) running Linux (Ubuntu/Debian recommended).

## Prerequisites on VPS

1.  **Node.js (v18+)**:
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ```
2.  **Git**:
    ```bash
    sudo apt-get install -y git
    ```
3.  **PM2** (Process Manager):
    ```bash
    sudo npm install -g pm2
    ```

## Deployment Steps

1.  **Clone the Repository**:
    ```bash
    git clone <your-repo-url> bradd-rdt
    cd bradd-rdt
    ```
    *Alternatively, copy the files manually using SCP or FTP.*

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Build the Project**:
    This will compile the server and build the frontend React application.
    ```bash
    npm run build
    ```

4.  **Start the Server**:
    We use PM2 to keep the server running in the background.
    ```bash
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup
    ```

5.  **Access the Application**:
    Open your browser and navigate to `http://<YOUR_VPS_IP>:3000`.

## Configuration (Optional)

### Running on Port 80 (HTTP)
You can redirect port 80 to 3000 or use Nginx as a reverse proxy.

**Using Nginx (Recommended):**
1.  Install Nginx: `sudo apt install nginx`
2.  Create config: `sudo nano /etc/nginx/sites-available/bradd-rdt`
    ```nginx
    server {
        listen 80;
        server_name your-domain.com; # or your IP

        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
        }
    }
    ```
3.  Enable it:
    ```bash
    sudo ln -s /etc/nginx/sites-available/bradd-rdt /etc/nginx/sites-enabled/
    sudo rm /etc/nginx/sites-enabled/default
    sudo nginx -t
    sudo systemctl restart nginx
    ```

### WebRTC & Firewall
-   Ensure **TCP port 3000** (or 80 if using Nginx) is open.
-   WebRTC uses random UDP ports for direct connection. If behind strict NAT, you might need a TURN server.
-   The current setup uses Google's public STUN server which works for most direct connections.

## Building Clients
Once deployed, go to the **Client Builder** page in the web dashboard.
-   Enter the **Client Name**.
-   Enter the **Server URL** (e.g., `http://<YOUR_VPS_IP>:3000` or `http://your-domain.com`).
-   Click **Build**.
-   Download and run the `.exe` on the target Windows machine.
