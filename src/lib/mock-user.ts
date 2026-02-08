export interface MockUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarInitials: string;
}

export const MOCK_USER: MockUser = {
  id: "user_mock_001",
  email: "john.doe@example.com",
  firstName: "John",
  lastName: "Doe",
  avatarInitials: "JD",
};

export const IS_DEMO_MODE =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true"
    : process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true";

export function getMockBuyerInfo() {
  return {
    email: MOCK_USER.email,
    first_name: MOCK_USER.firstName,
    last_name: MOCK_USER.lastName,
  };
}
