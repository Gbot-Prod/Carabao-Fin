import { StyleSheet, Text, View, Button } from "react-native";
import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useRouter } from "expo-router";

const Home = () => {
  const { user, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user]);

  if (!user) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {user.username}</Text>
      <Button title="Logout" onPress={logout} />
    </View>
  );
};

export default Home;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    marginBottom: 12,
  },
});