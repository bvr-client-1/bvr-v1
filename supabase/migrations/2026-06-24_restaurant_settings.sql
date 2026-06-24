-- Create restaurant_runtime_state table
CREATE TABLE IF NOT EXISTS restaurant_runtime_state (
  key TEXT PRIMARY KEY DEFAULT 'default',
  kitchen_paused BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  table_count INTEGER NOT NULL DEFAULT 16,
  delivery_radius_km NUMERIC NOT NULL DEFAULT 4.0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by_role TEXT
);

-- Insert default row if it doesn't exist
INSERT INTO restaurant_runtime_state (key, kitchen_paused, maintenance_mode, table_count, delivery_radius_km, updated_by_role)
VALUES ('default', FALSE, FALSE, 16, 4.0, 'system')
ON CONFLICT (key) DO NOTHING;
