-- Удаляем старую функцию, если она существует
DROP FUNCTION IF EXISTS public.add_player_and_update_room(p_room_id text, p_telegram_id bigint, p_username text, p_display_name text, p_avatar text, p_gifts_to_add integer, p_ton_value_to_add double precision, p_color text, p_is_participant boolean);

-- Создаем или заменяем функцию add_player_and_update_room
CREATE OR REPLACE FUNCTION public.add_player_and_update_room(
    p_room_id text,
    p_telegram_id bigint,
    p_username text,
    p_display_name text,
    p_avatar text,
    p_gifts_to_add integer,
    p_ton_value_to_add double precision,
    p_color text,
    p_is_participant boolean
)
RETURNS public.rooms -- Изменено на public.rooms, так как функция возвращает одну строку
LANGUAGE plpgsql
AS $$
DECLARE
    v_player_id uuid; -- Изменено на uuid, так как id в таблице players - uuid
    v_existing_player_id uuid; -- Изменено на uuid
    v_current_ton_value DOUBLE PRECISION;
    v_current_gifts INT;
    v_new_ton_value DOUBLE PRECISION;
    v_new_gifts INT;
    v_total_participants INT;
    v_new_room_status public.room_status_type; -- Используем ENUM тип
    v_new_countdown_end_time TIMESTAMP WITH TIME ZONE;
    v_current_room_status public.room_status_type; -- Используем ENUM тип
    v_current_countdown_end_time TIMESTAMP WITH TIME ZONE;
    v_updated_room public.rooms; -- Переменная для хранения обновленной комнаты
BEGIN
    -- Устанавливаем безопасный search_path для функции
    SET search_path = pg_catalog, public;

    -- Проверяем, существует ли игрок уже в этой комнате
    SELECT id, ton_value, gifts INTO v_existing_player_id, v_current_ton_value, v_current_gifts
    FROM public.players -- Указываем public.players
    WHERE room_id = p_room_id AND telegram_id = p_telegram_id;

    IF v_existing_player_id IS NOT NULL THEN
        -- Игрок существует, обновляем его данные
        v_new_ton_value := v_current_ton_value + p_ton_value_to_add;
        v_new_gifts := v_current_gifts + p_gifts_to_add;
        UPDATE public.players -- Указываем public.players
        SET
            username = p_username,
            display_name = p_display_name,
            avatar = p_avatar,
            gifts = v_new_gifts,
            ton_value = v_new_ton_value,
            color = p_color,
            is_participant = p_is_participant,
            last_active_at = NOW(),
            updated_at = NOW() -- Обновляем updated_at
        WHERE id = v_existing_player_id;
        v_player_id := v_existing_player_id;
    ELSE
        -- Игрок не существует, вставляем нового
        -- Генерируем UUID для id
        v_player_id := gen_random_uuid();
        INSERT INTO public.players (id, room_id, telegram_id, username, display_name, avatar, gifts, ton_value, color, percentage, is_participant, created_at, last_active_at, updated_at) -- Добавляем updated_at
        VALUES (v_player_id, p_room_id, p_telegram_id, p_username, p_display_name, p_avatar, p_gifts_to_add, p_ton_value_to_add, p_color, 0, p_is_participant, NOW(), NOW(), NOW());
    END IF;

    -- Получаем текущий статус комнаты и время окончания отсчета
    SELECT status, countdown_end_time INTO v_current_room_status, v_current_countdown_end_time
    FROM public.rooms -- Указываем public.rooms
    WHERE id = p_room_id;

    -- Пересчитываем общее количество участников, подарков и TON для комнаты
    -- Важно: пересчитываем после обновления/вставки игрока
    SELECT COUNT(*), COALESCE(SUM(ton_value), 0), COALESCE(SUM(gifts), 0)
    INTO v_total_participants, v_new_ton_value, v_new_gifts
    FROM public.players -- Указываем public.players
    WHERE room_id = p_room_id AND is_participant = TRUE;

    v_new_room_status := v_current_room_status;
    v_new_countdown_end_time := v_current_countdown_end_time;

    IF v_total_participants >= 2 THEN
        -- Если 2 или более участников, и комната не в состоянии отсчета/вращения
        IF v_current_room_status = 'waiting' OR v_current_room_status = 'single_player' THEN
            v_new_room_status := 'countdown';
            v_new_countdown_end_time := NOW() + INTERVAL '20 seconds'; -- Начинаем новый отсчет
        END IF;
    ELSIF v_total_participants = 1 THEN
        v_new_room_status := 'single_player';
        v_new_countdown_end_time := NULL; -- Сбрасываем отсчет, если только один игрок
    ELSE -- v_total_participants = 0
        v_new_room_status := 'waiting';
        v_new_countdown_end_time := NULL; -- Сбрасываем отсчет, если нет участников
    END IF;

    -- Обновляем состояние комнаты и возвращаем ее
    UPDATE public.rooms -- Указываем public.rooms
    SET
        status = v_new_room_status,
        countdown_end_time = v_new_countdown_end_time,
        total_gifts = v_new_gifts,
        total_ton = v_new_ton_value,
        updated_at = NOW() -- Обновляем updated_at
    WHERE id = p_room_id
    RETURNING * INTO v_updated_room; -- Захватываем обновленную строку

    RETURN v_updated_room; -- Возвращаем обновленную строку
END;
$$;
