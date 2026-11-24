// app/onboarding.tsx
// S18 (plan §5.12): the native merchant application (status first when one exists, else the
// form; `?step=business` opens the business step). Reachable before the account has a farm
// (gate status `forbidden`) and after (`allowed`): see the onboarding group in app/_layout.tsx.
export { default } from '../src/screens/OnboardingScreen';
