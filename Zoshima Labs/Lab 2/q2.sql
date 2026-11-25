-- 2. Filtering and Sorting

SELECT student_id, name, branch
FROM student
WHERE branch = 'CSE'
ORDER BY name ASC;