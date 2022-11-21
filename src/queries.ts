export const resourceBase = `
SELECT 
  name, title, description, 
  owner_account_id, 
  contact_info as contactInfo, 
  image_url as titleImage,
  tagList
FROM
  ( 
    SELECT 
      * 
    from 
      resources as r
    LEFT JOIN resource_images as i ON 
      r.name == i.resource_name AND
      i.position == 0
  ) as b, 
  (
    SELECT 
      resource_name, GROUP_CONCAT(tag,",") as tagList
    FROM 
      resource_tags
    GROUP BY
      resource_name
  ) as t
WHERE 
  b.name == t.resource_name
`
