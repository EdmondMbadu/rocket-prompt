# CSV Bulk Upload Instructions

## CSV Format

The CSV file must have the following structure:

### Required Columns:
- `title` - The title of the prompt (string)
- `content` - The content/body of the prompt (string)
- `tag` - The tag/category for the prompt (string, will be converted to lowercase)

### Optional Columns:
- `customUrl` - Custom URL slug for the prompt (string, optional)
- `views` - Initial view count (number, defaults to 0)
- `likes` - Initial like count (number, defaults to 0)
- `launchGpt` - Initial GPT launch count (number, defaults to 0)
- `launchGemini` - Initial Gemini launch count (number, defaults to 0)
- `launchClaude` - Initial Claude launch count (number, defaults to 0)
- `copied` - Initial copy count (number, defaults to 0)
- `isInvisible` - Whether the prompt should be hidden (boolean: true/false/1/0/yes/no, defaults to false)

## Example CSV

```csv
title,content,tag,customUrl,views,likes,launchGpt,launchGemini,launchClaude,copied,isInvisible
"Getting Started with React","Create a new React application using create-react-app and explain the basic structure","react","getting-started-react",0,0,0,0,0,0,false
"Python Data Analysis","How to analyze data using pandas and matplotlib in Python","python","python-data-analysis",10,5,3,2,1,2,false
"Hidden Prompt","This prompt will be hidden from public view","general","",0,0,0,0,0,0,true
```

## Notes

1. The CSV must have a header row with column names
2. Column names are case-insensitive (title, Title, TITLE all work)
3. Multi-word column names can use camelCase (customUrl) or snake_case (custom_url)
4. Text fields can contain commas if they are wrapped in double quotes
5. Double quotes within text fields should be escaped as two double quotes ("")
6. The `authorId` is automatically set to the currently logged-in user
7. The `createdAt` and `updatedAt` timestamps are automatically set by the server
8. All prompts created via CSV upload will be assigned to the logged-in admin user

## Instructions for GPT to Generate Test CSV

Use the following prompt with GPT to generate a test CSV file:

---

**Prompt for GPT:**

Generate a CSV file for bulk uploading prompts to a prompt management system. The CSV should have the following columns:

**Required columns:**
- title: A descriptive title for each prompt (string)
- content: The full content/body text of the prompt (string, can be multi-line)
- tag: A category/tag for the prompt (e.g., "react", "python", "javascript", "general", "productivity", "writing")

**Optional columns (include these with sample values):**
- customUrl: A URL-friendly slug (lowercase, hyphens instead of spaces, optional)
- views: Initial view count (number, 0-100)
- likes: Initial like count (number, 0-50)
- launchGpt: Initial GPT launch count (number, 0-20)
- launchGemini: Initial Gemini launch count (number, 0-20)
- launchClaude: Initial Claude launch count (number, 0-20)
- copied: Initial copy count (number, 0-30)
- isInvisible: Whether prompt is hidden (true/false, mostly false)

**Requirements:**
1. Create a CSV file with a header row containing all column names
2. Generate 10-15 sample prompts with diverse titles and content
3. Use a variety of tags (at least 5 different tags)
4. Include some prompts with customUrl values
5. Include varied numeric values for views, likes, and launch counts
6. Set isInvisible to true for 1-2 prompts
7. Ensure content fields that contain commas are properly quoted
8. Make the content realistic and useful (e.g., coding tips, productivity advice, writing prompts, etc.)

**Output format:** Provide the CSV content that can be saved directly to a .csv file.

---

## Testing

1. Log in as an admin user
2. Navigate to the Admin Dashboard
3. Click the "Upload CSV" button in the Prompts section
4. Select your CSV file
5. Monitor the progress bar and wait for completion
6. Check the error messages if any prompts fail to upload
7. Verify the prompts appear in the prompts list





