-- 4. Cursor-Based Doctor Appointment Summary

CREATE OR REPLACE FUNCTION
doctor_appointment_summary(doc_id INT)
RETURNS TABLE(
  patient_name VARCHAR(100),
  appt_date DATE,
  appt_status VARCHAR(20),
   diagnosis TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  appt_cursor CURSOR FOR
    SELECT p.name, a.appointment_date, a.status, t.diagnosis
    FROM appointment a
    JOIN patient p ON a.patient_id = p.patient_id
    LEFT JOIN treatment t
      ON a.appointment_id = t.appointment_id
    WHERE a.doctor_id = doc_id;
  v_name VARCHAR(100);
  v_date DATE;
  v_status VARCHAR(20);
  v_diagnosis VARCHAR(200);
BEGIN
  OPEN appt_cursor;
  LOOP
    FETCH appt_cursor
    INTO v_name, v_date, v_status, v_diagnosis;
    EXIT WHEN NOT FOUND;
    patient_name := v_name;
    appt_date := v_date;
    appt_status := v_status;
    diagnosis := COALESCE(v_diagnosis, 'Not yet treated');
    RETURN NEXT;
  END LOOP;
  CLOSE appt_cursor;
END;
$$;

SELECT *
FROM doctor_appointment_summary(2)
ORDER BY appt_date;