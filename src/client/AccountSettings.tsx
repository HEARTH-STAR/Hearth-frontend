import { useClerk, useUser } from '@clerk/react';
import { LogOut, UserRound } from 'lucide-react';
/** Settings' Account section: who is signed in, Clerk's profile, and sign out. */
export function AccountSettings({ onClose }: { onClose: () => void }) {
  const { user } = useUser();
  const clerk = useClerk();
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress;
  const name = user.fullName || user.username || email || 'Signed in';
  return (
    <fieldset className="appearance-fields">
      <legend>Account</legend>
      <div className="account-row">
        <img className="account-avatar" src={user.imageUrl} alt="" />
        <span className="account-text">
          <strong>{name}</strong>
          {email && email !== name && <small>{email}</small>}
        </span>
      </div>
      <div className="account-actions">
        <button
          type="button"
          onClick={() => {
            // Clerk's profile is its own modal; close Settings so they don't stack.
            onClose();
            clerk.openUserProfile();
          }}
        >
          <UserRound size={15} aria-hidden="true" />
          Manage account
        </button>
        <button type="button" onClick={() => void clerk.signOut()}>
          <LogOut size={15} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </fieldset>
  );
}
