-- 4. Inner Join

SELECT s.name, c.course_name, e.marks
FROM exam e
INNER JOIN student s ON e.student_id = s.student_id
INNER JOIN course c ON e.course_id = c.course_id
ORDER BY e.marks DESC, s.name ASC;