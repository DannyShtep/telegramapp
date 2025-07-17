-- Удаляем старую функцию, если она существует
DROP FUNCTION IF EXISTS public.add_player_and_update_room(p_room_id text, p_telegram_id bigint, p_username text, p_display_name text, p_avatar text, p_gifts_to_add integer, p_ton_value_to_add numeric, p_color text, p_is_participant boolean);

-- Создаем или заменяем функцию add_player_and_update_room
CREATE OR REPLACE FUNCTION public.add_player_and_update_room(
    p_room_id text,
    p_telegram_id bigint,
    p_username text,
    p_display_name text,
    p_avatar text,
    p_gifts_to_add integer,
    p_ton_value_to_add numeric,
    p_color text,
    p_is_participant boolean
)
RETURNS public.rooms
LANGUAGE plpgsql
AS $$
DECLARE
    v_player_id uuid;
    v_current_ton_value numeric;
    v_current_gifts integer;
    v_room_status text;
    v_room_total_gifts integer;
    v_room_total_ton numeric;
    v_updated_room public.rooms;
    v_participant_count integer;
BEGIN
    -- Проверяем, существует ли игрок
    SELECT id, ton_value, gifts
    INTO v_player_id, v_current_ton_value, v_current_gifts
    FROM public.players
    WHERE room_id = p_room_id AND telegram_id = p_telegram_id;

    IF v_player_id IS NOT NULL THEN
        -- Обновляем существующего игрока
        UPDATE public.players
        SET
            username = p_username,
            display_name = p_display_name,
            avatar = p_avatar,
            gifts = v_current_gifts + p_gifts_to_add,
            ton_value = v_current_ton_value + p_ton_value_to_add,
            color = p_color,
            is_participant = p_is_participant,
            last_active_at = NOW(),
            updated_at = NOW()
        WHERE id = v_player_id;
    ELSE
        -- Вставляем нового игрока
        INSERT INTO public.players (
            room_id,
            telegram_id,
            username,
            display_name,
            avatar,
            gifts,
            ton_value,
            color,
            percentage,
            is_participant,
            last_active_at
        )
        VALUES (
            p_room_id,
            p_telegram_id,
            p_username,
            p_display_name,
            p_avatar,
            p_gifts_to_add,
            p_ton_value_to_add,
            p_color,
            0, -- Начальный процент
            p_is_participant,
            NOW()
        )
        RETURNING id INTO v_player_id;
    END IF;

    -- Получаем текущий статус комнаты и общие значения
    SELECT status, total_gifts, total_ton
    INTO v_room_status, v_room_total_gifts, v_room_total_ton
    FROM public.rooms
    WHERE id = p_room_id;

    -- Обновляем общие подарки и ТОН в комнате
    UPDATE public.rooms
    SET
        total_gifts = v_room_total_gifts + p_gifts_to_add,
        total_ton = v_room_total_ton + p_ton_value_to_add,
        updated_at = NOW()
    WHERE id = p_room_id;

    -- Пересчитываем проценты для всех участников
    UPDATE public.players AS p
    SET percentage =
        CASE
            WHEN r.total_ton > 0 THEN (p.ton_value / r.total_ton) * 100
            ELSE 0
        END
    FROM public.rooms AS r
    WHERE p.room_id = r.id AND r.id = p_room_id AND p.is_participant = TRUE;

    -- Получаем обновленную комнату
    SELECT *
    INTO v_updated_room
    FROM public.rooms
    WHERE id = p_room_id;

    RETURN v_updated_room;
END;
$$;
