/**
 * Generates a unique username from firstName, lastName, and userId
 * Format: firstnameLastname + shortCode (e.g., "johnDoeA3b2")
 * The code is derived from the userId to ensure uniqueness
 */
export function generateUsername(firstName: string, lastName: string, userId: string): string {
  // Normalize names: remove spaces, special chars, convert to lowercase
  const cleanFirstName = firstName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15); // Limit length
  
  const cleanLastName = lastName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15);
  
  // Generate a short code from userId (first 8 chars, alphanumeric only)
  // This ensures uniqueness while keeping it short
  const userIdCode = userId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase();
  
  // Combine: firstName + lastName + code
  const baseUsername = `${cleanFirstName}${cleanLastName}${userIdCode}`;
  
  // Ensure it's not too long (max 30 chars total)
  return baseUsername.slice(0, 30);
}

/**
 * Generates a display username from firstName, lastName, and userId
 * Format: firstNameLastName + shortCode (e.g., "johnDoeA3b")
 * Uses 2-3 characters from the start of the userId for uniqueness
 */
export function generateDisplayUsername(firstName: string, lastName: string, userId: string): string {
  // Normalize names: capitalize first letter, remove special chars
  const cleanFirstName = firstName
    .trim()
    .replace(/[^a-z0-9\s]/gi, '')
    .split(/\s+/)[0] // Take first word only
    .toLowerCase();
  
  const cleanLastName = lastName
    .trim()
    .replace(/[^a-z0-9\s]/gi, '')
    .split(/\s+/)[0] // Take first word only
    .toLowerCase();
  
  // Get 2-3 characters from the start of userId (alphanumeric only)
  // Use 3 characters for better uniqueness
  const userIdCode = userId
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toLowerCase();
  
  // Combine: firstName + lastName + code
  // Capitalize first letter of firstName and lastName for readability
  const formattedFirstName = cleanFirstName.charAt(0).toUpperCase() + cleanFirstName.slice(1);
  const formattedLastName = cleanLastName.charAt(0).toUpperCase() + cleanLastName.slice(1);
  
  return `${formattedFirstName}${formattedLastName}${userIdCode}`;
}

/**
 * Validates if a username is in the correct format
 */
export function isValidUsername(username: string): boolean {
  // Username should be alphanumeric, lowercase, 3-30 chars
  return /^[a-z0-9]{3,30}$/.test(username);
}


