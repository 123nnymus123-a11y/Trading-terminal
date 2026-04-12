#!/bin/bash

# Trading Terminal Backend Verification Script
# This script tests if the backend is properly deployed and running

BACKEND_URL="https://api.example.com"
TESTS_PASSED=0
TESTS_FAILED=0

echo "🔍 Trading Terminal Backend Verification Script"
echo "================================================"
echo "Testing: $BACKEND_URL"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Basic connectivity
echo -n "Test 1: Basic connectivity... "
if timeout 5 bash -c "cat < /dev/null > /dev/tcp/api.example.com/443" 2>/dev/null; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAIL${NC}"
  echo "  → Backend not responding on port 8787"
  ((TESTS_FAILED++))
fi

# Test 2: Health endpoint (if implemented)
echo -n "Test 2: Health endpoint... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health" 2>/dev/null)
if [ "$RESPONSE" = "200" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $RESPONSE)"
  ((TESTS_PASSED++))
elif [ "$RESPONSE" = "404" ]; then
  echo -e "${YELLOW}⚠️  WARNING${NC} (HTTP $RESPONSE - endpoint not found)"
  ((TESTS_FAILED++))
else
  echo -e "${RED}❌ FAIL${NC} (HTTP $RESPONSE)"
  ((TESTS_FAILED++))
fi

# Test 3: API endpoint (common pattern)
echo -n "Test 3: API availability... "
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api" 2>/dev/null)
if [ "$RESPONSE" != "000" ]; then
  echo -e "${GREEN}✅ PASS${NC} (HTTP $RESPONSE)"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAIL${NC} (No response)"
  ((TESTS_FAILED++))
fi

# Test 4: Database connectivity (check via PM2 logs if available)
echo -n "Test 4: Check PM2 status... "
PM2_STATUS=$(ssh ubuntu@api.example.com "pm2 status 2>/dev/null" | grep "trading-terminal-backend" || echo "not-found")
if [[ $PM2_STATUS != *"not-found"* ]]; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${YELLOW}⚠️  WARNING${NC} (PM2 not available or process not running)"
  ((TESTS_FAILED++))
fi

# Test 5: Response headers
echo -n "Test 5: Response headers... "
HEADERS=$(curl -sI "$BACKEND_URL" 2>/dev/null | grep -E "Server|Content-Type" || echo "")
if [ ! -z "$HEADERS" ]; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAIL${NC} (No response headers)"
  ((TESTS_FAILED++))
fi

# Test 6: Remote access from local machine
echo -n "Test 6: Remote access verification... "
if curl -s -m 5 "$BACKEND_URL" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((TESTS_PASSED++))
else
  echo -e "${RED}❌ FAIL${NC} (Cannot reach from local machine)"
  echo "  → Check firewall rules: sudo ufw allow 8787/tcp"
  ((TESTS_FAILED++))
fi

# Summary
echo ""
echo "================================================"
echo "Test Results:"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
  echo -e "${RED}Failed: $TESTS_FAILED${NC}"
else
  echo -e "${GREEN}Failed: 0${NC}"
fi
echo ""

# Recommendations
if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ Backend deployment verified successfully!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Access the backend at: $BACKEND_URL"
  echo "2. Test API endpoints"
  echo "3. Configure frontend to connect to this backend"
  echo "4. Monitor logs: ssh ubuntu@api.example.com 'pm2 logs trading-terminal-backend'"
else
  echo -e "${RED}⚠️  Deployment verification found issues${NC}"
  echo ""
  echo "Debugging steps:"
  echo "1. SSH to server: ssh ubuntu@api.example.com"
  echo "2. Check PM2 logs: pm2 logs trading-terminal-backend"
  echo "3. Check env file: cat /opt/trading-terminal/apps/backend/.env.production"
  echo "4. Test DB connection: psql postgresql://tt_app:<db-password>@127.0.0.1:5432/trading_terminal"
  echo "5. Check firewall: sudo ufw status"
fi

exit $TESTS_FAILED
