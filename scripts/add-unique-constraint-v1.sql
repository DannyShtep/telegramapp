ALTER TABLE public.players
ADD CONSTRAINT unique_player_room_telegram UNIQUE (room_id, telegram_id);
