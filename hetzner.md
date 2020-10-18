# Deploy instructions for Hetzner Cloud

## Server

### OS 
Ubuntu 20.04

### Type
CX31
2 VCPUs
8GB RAM
80GB SSD
20TB Traffic

## Setup

### Create new sudo user

```
ssh root@xxx.xxx.xxx.xxx
# enter new root password

adduser `username`
# enter password for new user

usermod -aG sudo `username`
su - `username`
```

### Install pre-requesites

```
su
apt-get update
apt-get upgrade

curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
apt-get install -y nodejs
npm install -g n
n 6

su - `username`
sudo apt install libzmq3-dev git python build-essential

exit
```
Make sure to exit so the terminal reloads with the new path variables

### Install mongodb
```
su
wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
apt-get update
apt-get install -y mongodb-org

su - `username`
sudo systemctl daemon-reload
sudo systemctl enable mongod
sudo systemctl start mongod
```

### Install bitcore
```
ssh navpay@xxx.xxx.xxx.xxx

sudo chown -R $USER /usr/local/lib
sudo chown -R $USER /usr/local/bin

npm install --unsafe-perm -g git://github.com/Encrypt-S/bitcore-node.git
bitcore-node create mynode
cd mynode
bitcore-node install insight-api
bitcore-node install bitcore-wallet-service

```

### Create systemctl service
```
sudo vi /etc/systemd/system/bitcore.service
```

paste the following into vi, replacing `username` with your ubuntu username
```
[Unit]
Description=bitcore-node
After=network.target
After=network-online.target

[Service]
User=`username`
Type=simple
WorkingDirectory=/home/`username`/mynode
ExecStart=/usr/local/bin/bitcore-node start
ExecReload=/bin/kill -HUP 
Restart=on-failure
RestartSec=15
PermissionsStartOnly=true
TimeoutStopSec=300

[Install]
WantedBy=multi-user.target
```

### Start and monitor the bitcore service

```
sudo systemctl enable bitcore
sudo systemctl start bitcore
sudo journalctl -u bitcore.service -f
```
The service should start and begin to sync the blockchain.


### Setup nginx
```
sudo apt-get install nginx
sudo ufw app list
sudo ufw allow 'Nginx HTTPS'
sudo ufw allow 'Nginx HTTP'
sudo ufw allow OpenSSH
sudo ufw enable

sudo vi /etc/nginx/sites-available/navpay.conf
```

paste the following into vi, replacing `api.navpay.org` with the url of your server as configured wth your dns provider;
```
server {
	server_name `api.navpay.org`;

	location / {

		proxy_set_header 	Access-Control-Allow-Origin *;	
		proxy_pass 		http://localhost:3232;
		proxy_http_version 	1.1;
        	proxy_set_header 	Upgrade $http_upgrade;
	        proxy_set_header 	Connection 'upgrade';
	        proxy_set_header 	Host $host;
	        proxy_cache_bypass	$http_upgrade;
	}
}
```
enable the site
```
sudo ln -s /etc/nginx/sites-available/navpay.conf /etc/nginx/sites-enabled
```

Install certbot and ssl certificates
```
sudo apt install snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx
```
go through the certbot wizard, selecting the url that was configured in /etc/nginx/sites-available/navpay.conf

