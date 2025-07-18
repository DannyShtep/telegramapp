-- rpc-add-player-and-update-room-v2.sql
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
    v_player_id text;
    v_room public.rooms;
    v_current_status public.room_status_enum;
    v_current_participants_count integer;
    v_new_countdown_end_time timestamp with time zone;
BEGIN
    -- Проверяем, существует ли игрок в этой комнате
    SELECT id INTO v_player_id
    FROM public.players
    WHERE room_id = p_room_id AND telegram_id = p_telegram_id;

    IF v_player_id IS NULL THEN
        -- Игрока нет, создаем нового
        v_player_id := gen_random_uuid(); -- Генерируем UUID для нового игрока
        INSERT INTO public.players (id, room_id, telegram_id, username, display_name, avatar, gifts, ton_value, color, percentage, is_participant, last_active_at)
        VALUES (v_player_id, p_room_id, p_telegram_id, p_username, p_display_name, p_avatar, p_gifts_to_add, p_ton_value_to_add, p_color, 0, p_is_participant, now());
    ELSE
        -- Игрок существует, обновляем его данные
        UPDATE public.players
        SET
            username = p_username,
            display_name = p_display_name,
            avatar = p_avatar,
            gifts = gifts + p_gifts_to_add,
            ton_value = ton_value + p_ton_value_to_add,
            color = p_color, -- Обновляем цвет, если он изменился
            is_participant = TRUE, -- Устанавливаем в true, так как игрок делает ставку
            last_active_at = now()
        WHERE id = v_player_id;
    END IF;

    -- Обновляем общие счетчики комнаты
    UPDATE public.rooms
    SET
        total_gifts = total_gifts + p_gifts_to_add,
        total_ton = total_ton + p_ton_value_to_add
    WHERE id = p_room_id
    RETURNING status, countdown_end_time INTO v_current_status, v_new_countdown_end_time;

    -- Проверяем количество участников для обновления статуса комнаты
    SELECT COUNT(*)
    INTO v_current_participants_count
    FROM public.players
    WHERE room_id = p_room_id AND is_participant = TRUE;

    -- Логика изменения статуса комнаты
    IF v_current_status = 'waiting' AND v_current_participants_count >= 2 THEN
        v_new_countdown_end_time := now() + INTERVAL '15 seconds';
        UPDATE public.rooms
        SET status = 'countdown', countdown_end_time = v_new_countdown_end_time
        WHERE id = p_room_id;
    ELSIF v_current_status = 'single_player' AND v_current_participants_count >= 2 THEN
        v_new_countdown_end_time := now() + INTERVAL '15 seconds';
        UPDATE public.rooms
        SET status = 'countdown', countdown_end_time = v_new_countdown_end_time
        WHERE id = p_room_id;
    ELSIF v_current_status = 'waiting' AND v_current_participants_count = 1 THEN
        UPDATE public.rooms
        SET status = 'single_player'
        WHERE id = p_room_id;
    END IF;

    -- Возвращаем обновленную комнату
    SELECT * INTO v_room
    FROM public.rooms
    WHERE id = p_room_id;

    RETURN v_room;
END;
$$;
