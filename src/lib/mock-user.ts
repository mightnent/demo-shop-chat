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

export function getMockBuyerInfo() {
  return {
    email: MOCK_USER.email,
    first_name: MOCK_USER.firstName,
    last_name: MOCK_USER.lastName,
  };
}
