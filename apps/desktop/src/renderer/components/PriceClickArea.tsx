import React from "react";
import { useOrderTicketStore } from "../store/orderTicketStore";

interface PriceClickAreaProps {
  symbol: string;
  minPrice: number;
  maxPrice: number;
  currentPrice: number;
  height?: number;
}

/**
 * Simple clickable area that converts Y-coordinate clicks to prices
 * and sends them to the order ticket. Use this in any chart component.
 */
export function PriceClickArea({
  symbol,
  minPrice,
  maxPrice,
  currentPrice,
  height = 300,
}: PriceClickAreaProps) {
  const setClickedPrice = useOrderTicketStore((s) => s.setClickedPrice);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const priceRange = maxPrice - minPrice;
    const clickedPrice = maxPrice - (y / height) * priceRange;
    
    setClickedPrice(symbol, clickedPrice);
    
    // Visual feedback
    console.log(`[PriceClickArea] Clicked price: $${clickedPrice.toFixed(2)} for ${symbol}`);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        position: "relative",
        width: "100%",
        height,
        background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        cursor: "crosshair",
        overflow: "hidden",
      }}
    >
      {/* Price labels */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          fontSize: 11,
          opacity: 0.5,
          pointerEvents: "none",
        }}
      >
        ${maxPrice.toFixed(2)}
      </div>
      
      {/* Current price line */}
      <div
        style={{
          position: "absolute",
          top: `${((maxPrice - currentPrice) / (maxPrice - minPrice)) * 100}%`,
          left: 0,
          right: 0,
          height: 2,
          background: "#6ea8fe",
          boxShadow: "0 0 8px rgba(110, 168, 254, 0.6)",
          pointerEvents: "none",
        }}
      />
      
      <div
        style={{
          position: "absolute",
          top: `${((maxPrice - currentPrice) / (maxPrice - minPrice)) * 100}%`,
          right: 8,
          transform: "translateY(-50%)",
          padding: "4px 8px",
          background: "rgba(110, 168, 254, 0.9)",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 700,
          color: "white",
          pointerEvents: "none",
        }}
      >
        ${currentPrice.toFixed(2)}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          fontSize: 11,
          opacity: 0.5,
          pointerEvents: "none",
        }}
      >
        ${minPrice.toFixed(2)}
      </div>

      {/* Helper text */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 13,
          opacity: 0.3,
          pointerEvents: "none",
          textAlign: "center",
        }}
      >
        Click to set order price<br />
        <span style={{ fontSize: 11 }}>(Chart click-to-set demo)</span>
      </div>
    </div>
  );
}
