-- 7. Subquery

SELECT student_id, name
FROM student
WHERE student_id NOT IN (
  SELECT student_id
  FROM exam
)
ORDER BY student_id;