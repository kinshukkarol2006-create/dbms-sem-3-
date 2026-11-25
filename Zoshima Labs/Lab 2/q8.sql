-- 8. Set Operation

SELECT student_id
FROM exam
WHERE marks >= 85

INTERSECT

SELECT student_id
FROM exam
WHERE course_id = 201

ORDER BY student_id;