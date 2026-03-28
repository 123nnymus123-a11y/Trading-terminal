DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_state'
  ) THEN
    INSERT INTO user_profiles (user_id)
    SELECT us.user_id
    FROM user_state us
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO user_settings (user_id, settings)
    SELECT us.user_id, COALESCE(us.settings, '{}'::jsonb)
    FROM user_state us
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO accounts (user_id, balance, equity, buying_power, daily_pnl, daily_pnl_percent)
    SELECT
      us.user_id,
      COALESCE((us.account->>'balance')::double precision, 100000),
      COALESCE((us.account->>'equity')::double precision, 100000),
      COALESCE((us.account->>'buyingPower')::double precision, 200000),
      COALESCE((us.account->>'dailyPnl')::double precision, 0),
      COALESCE((us.account->>'dailyPnlPercent')::double precision, 0)
    FROM user_state us
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO watchlists (user_id, symbol, note)
    SELECT
      us.user_id,
      COALESCE((entry->>'symbol')::text, ''),
      COALESCE((entry->>'note')::text, '')
    FROM user_state us,
         LATERAL jsonb_array_elements(COALESCE(us.watchlists, '[]'::jsonb)) AS entry
    WHERE COALESCE((entry->>'symbol')::text, '') <> '';

    INSERT INTO orders (
      order_id, user_id, symbol, side, qty, type, limit_price, stop_price, status,
      filled_qty, avg_fill_price, created_at, updated_at
    )
    SELECT
      COALESCE((entry->>'orderId')::text, CONCAT('legacy-', us.user_id, '-', row_number() OVER ())),
      us.user_id,
      COALESCE((entry->>'symbol')::text, 'UNKNOWN'),
      COALESCE((entry->>'side')::text, 'BUY'),
      COALESCE((entry->>'qty')::double precision, 0),
      COALESCE((entry->>'type')::text, 'MARKET'),
      NULLIF((entry->>'limitPrice')::double precision, NULL),
      NULLIF((entry->>'stopPrice')::double precision, NULL),
      COALESCE((entry->>'status')::text, 'PENDING'),
      COALESCE((entry->>'filledQty')::double precision, 0),
      COALESCE((entry->>'avgFillPrice')::double precision, 0),
      COALESCE((entry->>'createdAt')::bigint, (extract(epoch from NOW()) * 1000)::bigint),
      COALESCE((entry->>'updatedAt')::bigint, (extract(epoch from NOW()) * 1000)::bigint)
    FROM user_state us,
         LATERAL jsonb_array_elements(COALESCE(us.orders, '[]'::jsonb)) AS entry
    ON CONFLICT (order_id) DO NOTHING;

    INSERT INTO positions (user_id, symbol, qty, avg_price, unrealized_pnl, realized_pnl)
    SELECT
      us.user_id,
      COALESCE((entry->>'symbol')::text, 'UNKNOWN'),
      COALESCE((entry->>'qty')::double precision, 0),
      COALESCE((entry->>'avgPrice')::double precision, 0),
      COALESCE((entry->>'unrealizedPnl')::double precision, 0),
      COALESCE((entry->>'realizedPnl')::double precision, 0)
    FROM user_state us,
         LATERAL jsonb_array_elements(COALESCE(us.positions, '[]'::jsonb)) AS entry
    ON CONFLICT (user_id, symbol) DO NOTHING;
  END IF;
END $$;
