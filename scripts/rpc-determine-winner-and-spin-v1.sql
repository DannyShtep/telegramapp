-- Удаляем старую функцию, если она существует
DROP FUNCTION IF EXISTS public.determine_winner_and_spin(p_room_id text);

-- Создаем или заменяем функцию determine_winner_and_spin
CREATE OR REPLACE FUNCTION public.determine_winner_and_spin(
    p_room_id text
)
RETURNS public.rooms
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_ton DOUBLE PRECISION;
    v_winner_telegram_id BIGINT;
    v_random_value DOUBLE PRECISION;
    v_current_sum DOUBLE PRECISION := 0;
    v_player RECORD;
    v_updated_room public.rooms;
BEGIN
    -- Устанавливаем безопасный search_path для функции
    SET search_path = pg_catalog, public;

    -- Проверяем, есть ли участники в комнате
    SELECT COALESCE(SUM(ton_value), 0)
    INTO v_total_ton
    FROM public.players
    WHERE room_id = p_room_id AND is_participant = TRUE;

    IF v_total_ton = 0 THEN
        -- Если нет участников или общий TON равен 0, сбрасываем комнату и выходим
        UPDATE public.rooms
        SET
            status = 'waiting',
            countdown_end_time = NULL,
            winner_telegram_id = NULL,
            total_gifts = 0,
            total_ton = 0,
            updated_at = NOW()
        WHERE id = p_room_id
        RETURNING * INTO v_updated_room;
        RETURN v_updated_room;
    END IF;

    -- Обновляем процентное соотношение для всех участников
    UPDATE public.players
    SET percentage = (ton_value / v_total_ton) * 100,
        updated_at = NOW()
    WHERE room_id = p_room_id AND is_participant = TRUE;

    -- Выбираем случайное число от 0 до v_total_ton
    v_random_value := random() * v_total_ton;

    -- Определяем победителя на основе взвешенного распределения
    v_winner_telegram_id := NULL;
    FOR v_player IN
        SELECT telegram_id, ton_value
        FROM public.players
        WHERE room_id = p_room_id AND is_participant = TRUE
        ORDER BY telegram_id -- Для детерминированного порядка при одинаковых ton_value
    LOOP
        v_current_sum := v_current_sum + v_player.ton_value;
        IF v_random_value <= v_current_sum THEN
            v_winner_telegram_id := v_player.telegram_id;
            EXIT;
        END IF;
    END LOOP;

    -- Обновляем комнату: статус на 'spinning', устанавливаем победителя
    UPDATE public.rooms
    SET
        status = 'spinning',
        winner_telegram_id = v_winner_telegram_id,
        updated_at = NOW()
    WHERE id = p_room_id
    RETURNING * INTO v_updated_room;

    RETURN v_updated_room;
END;
$$;
