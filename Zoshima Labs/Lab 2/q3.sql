-- 3. Grouping and Aggregation

SELECT 
    course_id,
    COUNT(student_id) AS students_appeared,
    ROUND(AVG(marks), 2) AS average_marks,
    MAX(marks) AS top_marks
FROM 
    exam
GROUP BY 
    course_id
ORDER BY 
    course_id ASC;