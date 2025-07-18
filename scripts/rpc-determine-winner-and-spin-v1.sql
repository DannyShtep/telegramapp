-- rpc-determine-winner-and-spin-v1.sql
CREATE OR REPLACE FUNCTION public.determine_winner_and_spin(p_room_id text)
RETURNS public.rooms
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_ton numeric;
    v_random_value numeric;
    v_current_sum numeric := 0;
    v_winner_player_id text;
    v_winner_telegram_id bigint;
    v_room public.rooms;
BEGIN
    -- Получаем общую сумму TON для комнаты
    SELECT total_ton INTO v_total_ton
    FROM public.rooms
    WHERE id = p_room_id;

    -- Если нет участников или общая сумма TON равна 0, то победителя нет
    IF v_total_ton IS NULL OR v_total_ton = 0 THEN
        UPDATE public.rooms
        SET status = 'finished', winner_telegram_id = NULL
        WHERE id = p_room_id
        RETURNING * INTO v_room;
        RETURN v_room;
    END IF;

    -- Генерируем случайное число от 0 до total_ton
    v_random_value := random() * v_total_ton;

    -- Определяем победителя на основе случайного числа и ставок игроков
    FOR r IN (SELECT id, telegram_id, ton_value FROM public.players WHERE room_id = p_room_id AND is_participant = TRUE ORDER BY created_at ASC) LOOP
        v_current_sum := v_current_sum + r.ton_value;
        IF v_random_value <= v_current_sum THEN
            v_winner_player_id := r.id;
            v_winner_telegram_id := r.telegram_id;
            EXIT;
        END IF;
    END LOOP;

    -- Обновляем статус комнаты и победителя
    UPDATE public.rooms
    SET
        status = 'spinning', -- Устанавливаем статус 'spinning' для анимации
        winner_telegram_id = v_winner_telegram_id
    WHERE id = p_room_id
    RETURNING * INTO v_room;

    RETURN v_room;
END;
$$;
