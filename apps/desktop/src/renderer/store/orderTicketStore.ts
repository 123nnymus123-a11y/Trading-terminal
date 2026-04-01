import { create } from "zustand";

interface OrderTicketState {
  clickedPrice: number | null;
  clickedSymbol: string | null;
  
  setClickedPrice: (symbol: string, price: number) => void;
  clearClickedPrice: () => void;
}

export const useOrderTicketStore = create<OrderTicketState>((set) => ({
  clickedPrice: null,
  clickedSymbol: null,
  
  setClickedPrice: (symbol, price) => set({ clickedSymbol: symbol, clickedPrice: price }),
  clearClickedPrice: () => set({ clickedPrice: null, clickedSymbol: null }),
}));
