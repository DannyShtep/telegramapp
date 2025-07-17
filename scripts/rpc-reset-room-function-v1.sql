-- Удаляем старую функцию, если она существует
DROP FUNCTION IF EXISTS public.reset_room_function(p_room_id text);

-- Создаем или заменяем функцию reset_room_function
CREATE OR REPLACE FUNCTION public.reset_room_function(
    p_room_id text
)
RETURNS public.rooms
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated_room public.rooms;
BEGIN
    -- Удаляем всех игроков, которые не являются участниками (is_participant = false)
    DELETE FROM public.players
    WHERE room_id = p_room_id AND is_participant = FALSE;

    -- Обновляем оставшихся игроков (победителя), сбрасывая их статус участника и ставки
    UPDATE public.players
    SET
        gifts = 0,
        ton_value = 0,
        percentage = 0,
        is_participant = FALSE, -- Сбрасываем статус участника
        updated_at = NOW()
    WHERE room_id = p_room_id;

    -- Сбрасываем состояние комнаты
    UPDATE public.rooms
    SET
        status = 'waiting', -- Возвращаем в ожидание
        countdown = 20,
        countdown_end_time = NULL, -- Сбрасываем время отсчета
        winner_telegram_id = NULL,
        total_gifts = 0,
        total_ton = 0,
        updated_at = NOW()
    WHERE id = p_room_id
    RETURNING * INTO v_updated_room;

    RETURN v_updated_room;
END;
$$;
