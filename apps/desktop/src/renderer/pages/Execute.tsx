import React, { useState, useEffect } from "react";
import { useTrading } from "../hooks/useTrading";
import { useTradingStore } from "../store/tradingStore";
import { useMarketData } from "../marketData/useMarketData";
import { useOrderTicketStore } from "../store/orderTicketStore";
import { PriceClickArea } from "../components/PriceClickArea";

// Trade setup configurations
const TRADE_SETUPS = [
  "Breakout",
  "Pullback",
  "Reversal",
  "Trend Continuation",
  "Range Bound",
  "Gap Fill",
];

export function Execute() {
  const { placeOrder, cancelOrder } = useTrading();
  const account = useTradingStore((s) => s.account);
  const positions = useTradingStore((s) => s.positions);
  const orders = useTradingStore((s) => s.orders);
  const prices = useMarketData();
  
  // Chart click integration
  const clickedPrice = useOrderTicketStore((s) => s.clickedPrice);
  const clickedSymbol = useOrderTicketStore((s) => s.clickedSymbol);
  const clearClickedPrice = useOrderTicketStore((s) => s.clearClickedPrice);

  // Trade Planner state
  const [selectedSetup, setSelectedSetup] = useState(TRADE_SETUPS[0]);
  const [accountRiskPercent, setAccountRiskPercent] = useState(1.0);

  // Order Entry state
  const [symbol, setSymbol] = useState("AAPL");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("LIMIT");
  const [qty, setQty] = useState(100);
  const [limitPrice, setLimitPrice] = useState(0);
  const [stopPrice, setStopPrice] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Risk Dashboard state
  const [maxDailyLoss, setMaxDailyLoss] = useState(1000);
  const [circuitBreakerEnabled, setCircuitBreakerEnabled] = useState(true);

  // Update prices
  const currentPrice = prices[symbol] || 0;


  // Handle chart click-to-set price
  useEffect(() => {
    if (clickedPrice !== null && clickedSymbol) {
      setSymbol(clickedSymbol);
      setLimitPrice(Number(clickedPrice.toFixed(2)));
      clearClickedPrice();
    }
  }, [clickedPrice, clickedSymbol, clearClickedPrice]);
  useEffect(() => {
    if (currentPrice > 0 && limitPrice === 0) {
      setLimitPrice(Number(currentPrice.toFixed(2)));
    }
  }, [currentPrice, limitPrice]);

  // Calculate position size based on risk
  const calculatePositionSize = () => {
    if (!account || stopPrice === 0 || limitPrice === 0) return 0;
    const riskAmount = account.balance * (accountRiskPercent / 100);
    const riskPerShare = Math.abs(limitPrice - stopPrice);
    if (riskPerShare === 0) return 0;
    return Math.floor(riskAmount / riskPerShare);
  };

  const handlePlaceOrder = async () => {
    try {
      const result = await placeOrder({
        symbol,
        side,
        qty,
        type: orderType,
        limitPrice: orderType === "LIMIT" ? limitPrice : undefined,
        tif: "DAY",
      });

      if (result?.accepted) {
        console.log("Order placed:", result.orderId);
        
        // Place OCO bracket orders if stop/target are set
        if (stopPrice > 0) {
          await placeOrder({
            symbol,
            side: side === "BUY" ? "SELL" : "BUY",
            qty,
            type: "STOP",
            stopPrice,
            tif: "DAY",
          });
        }
        if (targetPrice > 0) {
          await placeOrder({
            symbol,
            side: side === "BUY" ? "SELL" : "BUY",
            qty,
            type: "LIMIT",
            limitPrice: targetPrice,
            tif: "DAY",
          });
        }

        setShowConfirmModal(false);
      }
    } catch (err) {
      console.error("Order failed:", err);
    }
  };

  const totalPosition = positions.reduce((sum, p) => sum + Math.abs(p.qty * p.avgPrice), 0);
  const totalUnrealized = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const dailyLossProgress = account ? (account.dailyPnl / maxDailyLoss) * 100 : 0;

  return (
    <div style={{ height: "100%", display: "flex", gap: 20 }}>
      {/* LEFT: Trade Planner */}
      <div style={{ flex: "0 0 300px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <div className="cardTitle">📋 Trade Planner</div>
          <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                Setup Type
              </label>
              <select
                value={selectedSetup}
                onChange={(e) => setSelectedSetup(e.target.value)}
                style={{
                  width: "100%",
                  padding: 8,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  color: "white",
                }}
              >
                {TRADE_SETUPS.map((setup) => (
                  <option key={setup} value={setup}>
                    {setup}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Pre-Trade Checklist</div>
              <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.6 }}>
                ☐ Confirm setup pattern<br />
                ☐ Check volume profile<br />
                ☐ Verify support/resistance<br />
                ☐ Review market context<br />
                ☐ Calculate position size
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                Account Risk %
              </label>
              <input
                type="number"
                value={accountRiskPercent}
                onChange={(e) => setAccountRiskPercent(Number(e.target.value))}
                step={0.1}
                min={0.1}
                max={5}
                style={{
                  width: "100%",
                  padding: 8,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  color: "white",
                }}
              />
            </div>

            <div style={{ padding: 12, background: "rgba(110,168,254,0.1)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Calculated Size</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {calculatePositionSize()} shares
              </div>
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
                Based on {accountRiskPercent}% risk
              </div>
            </div>

            <button
              onClick={() => setQty(calculatePositionSize())}
              style={{
                padding: 10,
                background: "rgba(110,168,254,0.15)",
                border: "1px solid rgba(110,168,254,0.3)",
                borderRadius: 6,
                color: "#6ea8fe",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Apply to Order
            </button>
          </div>
        </div>
      </div>

      {/* CENTER: Order Entry */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <div className="cardTitle">⚡ Order Entry</div>
          <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                  Symbol
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  style={{
                    width: "100%",
                    padding: 10,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    color: "white",
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                  Market Price
                </label>
                <div
                  style={{
                    padding: 10,
                    background: "rgba(51,209,122,0.1)",
                    border: "1px solid rgba(51,209,122,0.2)",
                    borderRadius: 6,
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#33d17a",
                  }}
                >
                  ${currentPrice.toFixed(2)}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                  Side
                </label>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => setSide("BUY")}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: side === "BUY" ? "rgba(51,209,122,0.2)" : "rgba(255,255,255,0.05)",
                      border: side === "BUY" ? "1px solid rgba(51,209,122,0.4)" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: side === "BUY" ? "#33d17a" : "white",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => setSide("SELL")}
                    style={{
                      flex: 1,
                      padding: 10,
                      background: side === "SELL" ? "rgba(255,107,107,0.2)" : "rgba(255,255,255,0.05)",
                      border: side === "SELL" ? "1px solid rgba(255,107,107,0.4)" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: side === "SELL" ? "#ff6b6b" : "white",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    SELL
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                  Type
                </label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: 10,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    color: "white",
                    fontWeight: 600,
                  }}
                >
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                  Quantity
                </label>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: 10,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    color: "white",
                    fontWeight: 600,
                  }}
                />
              </div>
            </div>

            <div style={{ padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                OCO Bracket Builder
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 4 }}>
                    Entry Price
                  </label>
                  <input
                    type="number"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(Number(e.target.value))}
                    step={0.01}
                    disabled={orderType === "MARKET"}
                    style={{
                      width: "100%",
                      padding: 8,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6,
                      color: "white",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 4 }}>
                    Stop Loss
                  </label>
                  <input
                    type="number"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(Number(e.target.value))}
                    step={0.01}
                    style={{
                      width: "100%",
                      padding: 8,
                      background: "rgba(255,107,107,0.1)",
                      border: "1px solid rgba(255,107,107,0.2)",
                      borderRadius: 6,
                      color: "white",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 4 }}>
                    Target
                  </label>
                  <input
                    type="number"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(Number(e.target.value))}
                    step={0.01}
                    style={{
                      width: "100%",
                      padding: 8,
                      background: "rgba(51,209,122,0.1)",
                      border: "1px solid rgba(51,209,122,0.2)",
                      borderRadius: 6,
                      color: "white",
                    }}
                  />
                </div>
              </div>

              {limitPrice > 0 && stopPrice > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
                  Risk per share: ${Math.abs(limitPrice - stopPrice).toFixed(2)} |
                  Total risk: ${(Math.abs(limitPrice - stopPrice) * qty).toFixed(2)}
                  {targetPrice > 0 && (
                    <span>
                      {" "}| R:R = {(Math.abs(targetPrice - limitPrice) / Math.abs(limitPrice - stopPrice)).toFixed(2)}
                    </span>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowConfirmModal(true)}
              disabled={qty === 0 || !symbol}
              style={{
                padding: 16,
                background: side === "BUY" ? "rgba(51,209,122,0.2)" : "rgba(255,107,107,0.2)",
                border: side === "BUY" ? "2px solid rgba(51,209,122,0.4)" : "2px solid rgba(255,107,107,0.4)",
                borderRadius: 8,
                color: side === "BUY" ? "#33d17a" : "#ff6b6b",
                fontSize: 16,
                fontWeight: 700,
                cursor: qty === 0 ? "not-allowed" : "pointer",
                opacity: qty === 0 ? 0.5 : 1,
              }}
            >
              {side} {qty} {symbol} @ {orderType}
            </button>
          </div>
        </div>

        {/* Active Orders */}
        <div className="card">
          <div className="cardTitle">📝 Active Orders</div>
          <div className="cardBody" style={{ maxHeight: 200, overflow: "auto" }}>
            {orders.filter((o) => o.status === "PENDING").length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: 13 }}>No active orders</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {orders
                  .filter((o) => o.status === "PENDING")
                  .map((order) => (
                    <div
                      key={order.orderId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: 8,
                        background: "rgba(255,255,255,0.03)",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700 }}>{order.symbol}</span>{" "}
                        <span style={{ color: order.side === "BUY" ? "#33d17a" : "#ff6b6b" }}>
                          {order.side}
                        </span>{" "}
                        {order.qty} @ {order.type}
                        {order.limitPrice && ` $${order.limitPrice.toFixed(2)}`}
                      </div>
                      <button
                        onClick={() => cancelOrder(order.orderId)}
                        style={{
                          padding: "4px 8px",
                          background: "rgba(255,107,107,0.2)",
                          border: "1px solid rgba(255,107,107,0.3)",
                          borderRadius: 4,
                          color: "#ff6b6b",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Chart Click Demo */}
        <div className="card">
          <div className="cardTitle">📊 Chart Click-to-Set Demo</div>
          <div className="cardBody">
            <PriceClickArea
              symbol={symbol}
              minPrice={currentPrice * 0.95}
              maxPrice={currentPrice * 1.05}
              currentPrice={currentPrice}
              height={200}
            />
            <div style={{ marginTop: 8, fontSize: 11, opacity: 0.5, textAlign: "center" }}>
              Click anywhere on the area to set limit price
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: Risk Dashboard */}
      <div style={{ flex: "0 0 320px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card">
          <div className="cardTitle">🛡️ Risk Dashboard</div>
          <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>Daily P&L</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: (account?.dailyPnl || 0) >= 0 ? "#33d17a" : "#ff6b6b",
                }}
              >
                ${(account?.dailyPnl || 0).toFixed(2)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>
                {((account?.dailyPnlPercent || 0) >= 0 ? "+" : "")}
                {(account?.dailyPnlPercent || 0).toFixed(2)}%
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, opacity: 0.7 }}>Max Daily Loss</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>
                  ${Math.abs(account?.dailyPnl || 0).toFixed(0)} / ${maxDailyLoss}
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  background: "rgba(255,255,255,0.1)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(Math.abs(dailyLossProgress), 100)}%`,
                    height: "100%",
                    background:
                      Math.abs(dailyLossProgress) > 80
                        ? "#ff6b6b"
                        : Math.abs(dailyLossProgress) > 50
                        ? "#ffb84d"
                        : "#33d17a",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 4 }}>
                Max Daily Loss ($)
              </label>
              <input
                type="number"
                value={maxDailyLoss}
                onChange={(e) => setMaxDailyLoss(Number(e.target.value))}
                step={100}
                style={{
                  width: "100%",
                  padding: 8,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  color: "white",
                }}
              />
            </div>

            <div style={{ padding: 12, background: "rgba(255,184,77,0.1)", borderRadius: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={circuitBreakerEnabled}
                  onChange={(e) => setCircuitBreakerEnabled(e.target.checked)}
                />
                <span style={{ fontSize: 12 }}>Circuit Breaker (Auto-flatten on breach)</span>
              </label>
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
                Will automatically close all positions if max loss is reached
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ flex: 1 }}>
          <div className="cardTitle">📊 Positions</div>
          <div className="cardBody" style={{ overflow: "auto" }}>
            {positions.length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: 13 }}>No open positions</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {positions.map((pos) => (
                  <div
                    key={pos.symbol}
                    style={{
                      padding: 10,
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 6,
                      borderLeft: `3px solid ${pos.qty > 0 ? "#33d17a" : "#ff6b6b"}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>{pos.symbol}</span>
                      <span style={{ color: pos.qty > 0 ? "#33d17a" : "#ff6b6b", fontSize: 12 }}>
                        {pos.qty > 0 ? "LONG" : "SHORT"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {Math.abs(pos.qty)} shares @ ${pos.avgPrice.toFixed(2)}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: pos.unrealizedPnl >= 0 ? "#33d17a" : "#ff6b6b",
                        marginTop: 4,
                      }}
                    >
                      {pos.unrealizedPnl >= 0 ? "+" : ""}${pos.unrealizedPnl.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {positions.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  background: "rgba(110,168,254,0.1)",
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.7 }}>Total Exposure</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>${totalPosition.toFixed(2)}</div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: totalUnrealized >= 0 ? "#33d17a" : "#ff6b6b",
                  }}
                >
                  {totalUnrealized >= 0 ? "+" : ""}${totalUnrealized.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Modal */}
      {showConfirmModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            className="card"
            style={{ minWidth: 400, maxWidth: 500 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cardTitle">⚠️ Confirm Order</div>
            <div className="cardBody" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  {side} {qty} {symbol}
                </div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  Type: {orderType}
                  {orderType === "LIMIT" && ` @ $${limitPrice.toFixed(2)}`}
                </div>
                {stopPrice > 0 && (
                  <div style={{ fontSize: 13, color: "#ff6b6b" }}>Stop: ${stopPrice.toFixed(2)}</div>
                )}
                {targetPrice > 0 && (
                  <div style={{ fontSize: 13, color: "#33d17a" }}>
                    Target: ${targetPrice.toFixed(2)}
                  </div>
                )}
              </div>

              <div style={{ padding: 12, background: "rgba(255,184,77,0.1)", borderRadius: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Risk: ${(Math.abs(limitPrice - stopPrice) * qty).toFixed(2)}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Account impact: {((Math.abs(limitPrice - stopPrice) * qty) / (account?.balance || 100000) * 100).toFixed(2)}%
                </div>
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  style={{
                    flex: 1,
                    padding: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    color: "white",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handlePlaceOrder}
                  style={{
                    flex: 1,
                    padding: 12,
                    background: side === "BUY" ? "rgba(51,209,122,0.2)" : "rgba(255,107,107,0.2)",
                    border:
                      side === "BUY"
                        ? "2px solid rgba(51,209,122,0.4)"
                        : "2px solid rgba(255,107,107,0.4)",
                    borderRadius: 6,
                    color: side === "BUY" ? "#33d17a" : "#ff6b6b",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Send Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}