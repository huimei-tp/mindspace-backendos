# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install dependencies (only production)
RUN npm install --only=production

# Copy the rest of the source code
COPY . .

# OpenShift expects apps to listen on PORT (default 8080)
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Start the app
CMD ["npm", "start"]
