#!/bin/bash

# Build the project
npm run build

# Deploy to Vercel
vercel --prod 