#!/bin/bash

# Build the project
npm run build

# EC2 deployment instructions
# Replace with your actual EC2 deployment commands
echo "Please add your EC2 deployment commands here"
# Example:
# scp -i your-key.pem -r dist package.json ec2-user@your-ec2-instance:/path/to/app
# ssh -i your-key.pem ec2-user@your-ec2-instance "cd /path/to/app && npm install --production && pm2 restart app" 