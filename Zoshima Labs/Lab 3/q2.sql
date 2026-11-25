-- 2. Transactions and Savepoints

START TRANSACTION;
INSERT INTO appointment VALUES (705, 5, 4, '2026-08-03', '14:0:0', 'Scheduled');
SAVEPOINT after_booking;
UPDATE appointment
SET status = 'Completed'
WHERE appointment_id = 705;
ROLLBACK TO after_booking;
COMMIT;