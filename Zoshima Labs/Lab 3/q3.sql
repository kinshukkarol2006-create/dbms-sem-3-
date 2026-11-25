-- 3. Stored Procedures for Patient Registration and Treatment

CREATE OR REPLACE PROCEDURE register_patient(
  IN p_id INT,
  IN p_name VARCHAR(100),
  IN p_age INT,
  IN p_contact VARCHAR(15)
)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO patient (patient_id, name, age, contact)
  VALUES (p_id, p_name, p_age, p_contact);
END;
$$;

CREATE OR REPLACE PROCEDURE enter_treatment(
  IN a_id INT,
  IN t_id INT,
  IN diag VARCHAR(200),
  IN t_date DATE,
  IN presc_id INT,
  IN med VARCHAR(100),
  IN dose VARCHAR(50)
)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO treatment (treatment_id, appointment_id, diagnosis, treatment_date)
  VALUES (t_id, a_id, diag, t_date);
  INSERT INTO prescription(prescription_id, treatment_id, medicine, dosage)
  VALUES (presc_id, t_id, med, dose);
END;
$$;

CALL register_patient(7, 'Neha', 38, '9990007777');
CALL enter_treatment(701, 802, 'Seasonal allergy', '2026-08-01', 902, 'Cetirizine', '10mg once daily');