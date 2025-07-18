-- rpc-reset-room-function-v1.sql
CREATE OR REPLACE FUNCTION public.reset_room_function(p_room_id text)
RETURNS public.rooms
LANGUAGE plpgsql
AS $$
DECLARE
    v_room public.rooms;
BEGIN
    -- Обновляем статус комнаты на 'waiting', сбрасываем счетчики и победителя
    UPDATE public.rooms
    SET
        status = 'waiting',
        countdown = 20,
        countdown_end_time = NULL,
        total_gifts = 0,
        total_ton = 0,
        winner_telegram_id = NULL
    WHERE id = p_room_id
    RETURNING * INTO v_room;

    -- Сбрасываем is_participant и gifts/ton_value для всех игроков в этой комнате
    UPDATE public.players
    SET
        gifts = 0,
        ton_value = 0,
        is_participant = FALSE,
        percentage = 0
    WHERE room_id = p_room_id;

    RETURN v_room;
END;
$$;
