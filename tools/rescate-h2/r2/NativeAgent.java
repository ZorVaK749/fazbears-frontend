package r2lab;

import java.lang.instrument.Instrumentation;
import java.lang.management.ManagementFactory;
import java.lang.reflect.Field;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import java.io.*;
import javax.sql.DataSource;

/** R2 SOLO LAB: rechaza JVM sin marker/entorno sintéticos. No transformers ni driver H2 nuevo. */
public class NativeAgent {
    static final Path OUT = Path.of("/r2-out");
    static final String OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    public static void agentmain(String mode, Instrumentation instrumentation) {
        String phase = "guard";
        boolean authorizedLab = false;
        try {
            guard();
            authorizedLab = true;
            if (!Set.of("seed", "export1", "export2", "check", "race").contains(mode)) throw new IllegalArgumentException();
            phase = "existing-spring-context";
            Class<?> boot = Arrays.stream(instrumentation.getAllLoadedClasses())
                .filter(c -> c.getName().equals("org.springframework.boot.SpringApplication")).findFirst().orElseThrow();
            Field hookField = boot.getDeclaredField("shutdownHook"); hookField.setAccessible(true);
            Object hook = hookField.get(null);
            Field contextsField = hook.getClass().getDeclaredField("contexts"); contextsField.setAccessible(true);
            Collection<?> contexts = (Collection<?>) contextsField.get(hook);
            Object context;
            synchronized (hook) { if (contexts.size() != 1) throw new IllegalStateException(); context = contexts.iterator().next(); }
            Class<?> factory = Class.forName("org.springframework.beans.factory.BeanFactory", false, boot.getClassLoader());
            DataSource ds = (DataSource) factory.getMethod("getBean", String.class).invoke(context, "dataSource");
            phase = "existing-datasource";
            try (Connection c = ds.getConnection()) {
                String kind = System.getenv("R2_KIND");
                String expected = "jdbc:h2:mem:" + (kind.equals("carrito") ? "carritodb" : "pedidosdb");
                if (!c.getMetaData().getURL().equals(expected)) throw new IllegalStateException();
                Map<String,Object> meta = new TreeMap<>();
                meta.put("mode", mode); meta.put("kind", kind);
                meta.put("pid", ProcessHandle.current().pid());
                meta.put("jvmStartTime", ManagementFactory.getRuntimeMXBean().getStartTime());
                meta.put("jvmUptimeMs", ManagementFactory.getRuntimeMXBean().getUptime());
                meta.put("javaVersion", System.getProperty("java.runtime.version"));
                meta.put("driverVersion", c.getMetaData().getDriverVersion());
                meta.put("dataSource", ds.getClass().getName());
                meta.put("appClassLoader", boot.getClassLoader().getClass().getName());
                meta.put("memoryUsedBytes", Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
                long start = System.nanoTime();
                meta.put("wallStartMs", System.currentTimeMillis());
                phase = mode.equals("seed") ? "seed-synthetic-only" : "snapshot-before";
                if (mode.equals("seed")) seed(c, kind);
                Map<String,Object> before = snapshot(c);
                meta.put("before", before);
                if (mode.startsWith("export") || mode.equals("race")) {
                    if (mode.equals("race")) {
                        // Barrera artificial SOLO para el ensayo negativo: permitir escritura
                        // HTTP legítima de fixture después del inventario inicial.
                        write(OUT.resolve("race-ready"), "SYNTHETIC_BARRIER");
                        Thread.sleep(4000);
                    }
                    phase = "native-script";
                    Path path = OUT.resolve(mode + ".sql");
                    // Escritura exclusiva y 0600. No salida de SQL/filas/credenciales a consola.
                    try (var stream = Files.newOutputStream(path, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
                         var writer = new BufferedWriter(new OutputStreamWriter(stream, StandardCharsets.UTF_8));
                         Statement statement = c.createStatement()) {
                        Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
                        statement.setQueryTimeout(20); // No prometer cancelación dura de SCRIPT.
                        try (ResultSet rows = statement.executeQuery("SCRIPT NOPASSWORDS")) {
                            long bytes = 0;
                            while (rows.next()) {
                                String line = rows.getString(1);
                                bytes += line.getBytes(StandardCharsets.UTF_8).length + 1;
                                if (bytes > 32 * 1024 * 1024 || Files.exists(OUT.resolve("cancel"))) throw new IllegalStateException();
                                writer.write(line); writer.newLine();
                            }
                        }
                    }
                    meta.put("scriptSha256", hash(Files.readAllBytes(path)));
                    meta.put("scriptBytes", Files.size(path));
                    meta.put("passwordsIncluded", false);
                }
                phase = "snapshot-after";
                Map<String,Object> after = snapshot(c);
                meta.put("after", after); meta.put("sourceUnchanged", json(before).equals(json(after)));
                meta.put("durationMs", (System.nanoTime() - start) / 1_000_000);
                meta.put("wallEndMs", System.currentTimeMillis());
                meta.put("memoryUsedAfterBytes", Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
                write(OUT.resolve(mode + ".json"), json(meta));
                if (!json(before).equals(json(after))) throw new IllegalStateException();
            }
        } catch (Exception error) {
            try { if (authorizedLab) write(OUT.resolve("error-" + (Set.of("seed","export1","export2","check","race").contains(mode) ? mode : "guard") + ".json"),
                json(Map.of("phase", phase, "errorType", error.getClass().getName()))); }
            catch (Exception ignored) { }
            throw new IllegalStateException("R2_LAB_AGENT_FAILED"); // Sin mensajes SQL ni causes con datos.
        }
    }
    static void guard() throws Exception {
        if (!"SYNTHETIC_ONLY".equals(System.getenv("R2_SYNTHETIC_LAB_ONLY"))) throw new SecurityException();
        String run = System.getenv("R2_RUN_ID");
        if (run == null || !run.matches("[a-f0-9-]{36}") || !Files.readString(OUT.resolve("lab.marker")).equals(run)) throw new SecurityException();
        if (!Set.of("carrito","pedidos").contains(System.getenv("R2_KIND"))) throw new SecurityException();
    }
    static void seed(Connection c, String kind) throws Exception {
        String parent = kind.equals("carrito") ? "CARritos" : "PEDIDOS";
        try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT COUNT(*) FROM " + parent)) {
            r.next(); if (r.getLong(1) != 0) throw new IllegalStateException();
        }
        c.setAutoCommit(false);
        try (Statement s = c.createStatement()) {
            if (kind.equals("carrito")) {
                s.executeUpdate("INSERT INTO carritos(id,usuario_id,creado_en) VALUES (7,'" + OWNER + "',TIMESTAMP '2026-11-12 10:00:00.123456'),(29,'r2-unknown-alias',NULL),(41,'r2-empty-unknown',NULL)");
                s.executeUpdate("INSERT INTO items_carrito(id,carrito_id,producto_id,nombre_producto,cantidad,precio_unitario) VALUES (13,7,7,'R2 synthetic',2,12.34),(31,29,999,NULL,-1,4.56)");
                s.execute("ALTER TABLE carritos ALTER COLUMN id RESTART WITH 1001");
                s.execute("ALTER TABLE items_carrito ALTER COLUMN id RESTART WITH 2001");
            } else {
                s.executeUpdate("INSERT INTO pedidos(id,usuario_id,email_usuario,fecha_creacion,total,estado) VALUES (7,'" + OWNER + "','r2@example.invalid',TIMESTAMP '2026-11-12 10:00:00.123456',24.68,'PENDIENTE'),(29,'r2-unknown-alias','alias@example.invalid',NULL,77.77,'PREPARANDO'),(41,'r2-empty-unknown','empty@example.invalid',NULL,0,'COMPLETADO')");
                s.executeUpdate("INSERT INTO item_pedido(id,pedido_id,producto_id,nombre_producto,cantidad,precio_unitario) VALUES (13,7,7,'R2 synthetic',2,12.34),(31,29,999,NULL,-1,4.56)");
                s.execute("ALTER TABLE pedidos ALTER COLUMN id RESTART WITH 1001");
                s.execute("ALTER TABLE item_pedido ALTER COLUMN id RESTART WITH 2001");
            }
            s.execute("CREATE SCHEMA R2_EXTRA");
            s.execute("CREATE TABLE R2_EXTRA.UNMAPPED(id BIGINT PRIMARY KEY, note CLOB, payload BLOB, historical_state VARCHAR(30))");
            s.execute("INSERT INTO R2_EXTRA.UNMAPPED VALUES (9007199254740993,'R2 synthetic LOB',X'0001FF','CANCELADO'),(9007199254740994,NULL,NULL,NULL)");
            s.execute("CREATE SEQUENCE R2_EXTRA.GAP_SEQUENCE START WITH 17 INCREMENT BY 5 CACHE 1");
            s.executeQuery("SELECT NEXT VALUE FOR R2_EXTRA.GAP_SEQUENCE").close();
            s.executeQuery("SELECT NEXT VALUE FOR R2_EXTRA.GAP_SEQUENCE").close();
            s.execute("CREATE VIEW R2_EXTRA.COUNTS AS SELECT COUNT(*) AS N FROM R2_EXTRA.UNMAPPED");
            s.execute("CREATE INDEX R2_EXTRA.IX_HISTORICAL_STATE ON R2_EXTRA.UNMAPPED(HISTORICAL_STATE)");
        }
        c.commit(); c.setAutoCommit(true);
    }
    public static Map<String,Object> snapshot(Connection c) throws Exception {
        Map<String,Object> snapshot = new TreeMap<>();
        DatabaseMetaData md = c.getMetaData(); List<String[]> tables = new ArrayList<>();
        try (ResultSet r = md.getTables(null, null, "%", null)) {
            while (r.next()) if (!r.getString("TABLE_SCHEM").equals("INFORMATION_SCHEMA")
                && Set.of("BASE TABLE","TABLE").contains(r.getString("TABLE_TYPE")))
                tables.add(new String[]{r.getString("TABLE_SCHEM"), r.getString("TABLE_NAME")});
        }
        for (String[] table : tables) {
            String schema = table[0], name = table[1]; List<String> rows = new ArrayList<>();
            List<String> columns = new ArrayList<>();
            try (ResultSet r = md.getColumns(null, schema, name, "%")) {
                while (r.next()) columns.add(r.getString("COLUMN_NAME") + ":" + r.getString("TYPE_NAME")
                    + ":" + r.getInt("COLUMN_SIZE") + ":" + r.getInt("DECIMAL_DIGITS") + ":" + r.getInt("NULLABLE")
                    + ":" + r.getString("COLUMN_DEF"));
            }
            try (Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT * FROM " + q(schema) + "." + q(name))) {
                while (r.next()) {
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    for (int i = 1; i <= r.getMetaData().getColumnCount(); i++) {
                        Object value = r.getObject(i); byte[] bytes;
                        if (value == null) bytes = new byte[]{0};
                        else if (value instanceof Blob b) { if (b.length() > 1048576) throw new IllegalStateException(); bytes = b.getBytes(1, (int)b.length()); }
                        else if (value instanceof Clob cl) { if (cl.length() > 1048576) throw new IllegalStateException(); bytes = cl.getSubString(1, (int)cl.length()).getBytes(StandardCharsets.UTF_8); }
                        else if (value instanceof byte[] b) bytes = b;
                        else bytes = value.toString().getBytes(StandardCharsets.UTF_8);
                        digest.update((value == null ? "NULL:" : "VALUE:").getBytes(StandardCharsets.UTF_8));
                        digest.update((bytes.length + ":").getBytes(StandardCharsets.UTF_8)); digest.update(bytes);
                    }
                    rows.add(HexFormat.of().formatHex(digest.digest()));
                    if (rows.size() > 100000) throw new IllegalStateException();
                }
            }
            Collections.sort(rows);
            List<String> pk = metadata(md.getPrimaryKeys(null, schema, name), List.of("COLUMN_NAME","KEY_SEQ","PK_NAME"));
            List<String> fk = metadata(md.getImportedKeys(null, schema, name), List.of("FKCOLUMN_NAME","PKTABLE_SCHEM","PKTABLE_NAME","PKCOLUMN_NAME","KEY_SEQ","FK_NAME"));
            snapshot.put(schema + "." + name, Map.of("count",rows.size(),"rowsSha256",hash(String.join("\n",rows).getBytes(StandardCharsets.UTF_8)),"columns",columns,"pk",pk,"fk",fk));
        }
        snapshot.put("identities", query(c, "SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IDENTITY_BASE,IDENTITY_INCREMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE IS_IDENTITY='YES' AND TABLE_SCHEMA <> 'INFORMATION_SCHEMA' ORDER BY 1,2,3"));
        snapshot.put("sequences", query(c, "SELECT SEQUENCE_SCHEMA,SEQUENCE_NAME,BASE_VALUE,INCREMENT,MINIMUM_VALUE,MAXIMUM_VALUE,CYCLE_OPTION FROM INFORMATION_SCHEMA.SEQUENCES WHERE SEQUENCE_SCHEMA <> 'INFORMATION_SCHEMA' ORDER BY 1,2"));
        snapshot.put("views", query(c, "SELECT TABLE_SCHEMA,TABLE_NAME,VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA' ORDER BY 1,2"));
        snapshot.put("constraints", query(c, "SELECT CONSTRAINT_SCHEMA,CONSTRAINT_NAME,CONSTRAINT_TYPE,TABLE_SCHEMA,TABLE_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA' ORDER BY 1,2"));
        snapshot.put("checks", query(c, "SELECT CONSTRAINT_SCHEMA,CONSTRAINT_NAME,CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA <> 'INFORMATION_SCHEMA' ORDER BY 1,2"));
        // H2 regenera el nombre físico de ciertos índices auxiliares de constraints.
        // Se comparan sus columnas/orden/uniqueness; nombres de índices explícitos sí se conservan.
        List<String> indexes = new ArrayList<>();
        try(Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT INDEX_SCHEMA,INDEX_NAME,TABLE_SCHEMA,TABLE_NAME,INDEX_TYPE_NAME,IS_GENERATED FROM INFORMATION_SCHEMA.INDEXES WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA'")){
            while(r.next()){
                String schema=r.getString(1),name=r.getString(2);
                List<String> cols;
                try(PreparedStatement p=c.prepareStatement("SELECT COLUMN_NAME,ORDINAL_POSITION,ORDERING_SPECIFICATION,NULL_ORDERING,IS_UNIQUE FROM INFORMATION_SCHEMA.INDEX_COLUMNS WHERE INDEX_SCHEMA=? AND INDEX_NAME=? ORDER BY ORDINAL_POSITION")){
                    p.setString(1,schema);p.setString(2,name);try(ResultSet cr=p.executeQuery()){
                        cols=new ArrayList<>();while(cr.next())cols.add(json(Arrays.asList(cr.getString(1),cr.getString(2),cr.getString(3),cr.getString(4),cr.getString(5))));
                    }
                }
                indexes.add(json(Arrays.asList(schema,r.getString(3),r.getString(4),r.getString(5),r.getBoolean(6)?"GENERATED_BACKING_INDEX":name,cols)));
            }
        }
        Collections.sort(indexes);snapshot.put("indexes",indexes);
        return snapshot;
    }
    static List<String> metadata(ResultSet r, List<String> cols) throws Exception {
        try (r) { List<String> result = new ArrayList<>(); while(r.next()) { List<String> row = new ArrayList<>(); for(String col:cols) row.add(r.getString(col)); result.add(json(row)); } Collections.sort(result); return result; }
    }
    static List<String> query(Connection c, String sql) throws Exception {
        try(Statement s=c.createStatement(); ResultSet r=s.executeQuery(sql)) { List<String> rows=new ArrayList<>(); while(r.next()) { List<String> row=new ArrayList<>(); for(int i=1;i<=r.getMetaData().getColumnCount();i++) row.add(r.getString(i)); rows.add(json(row)); } return rows; }
    }
    static String q(String s) { return "\"" + s.replace("\"","\"\"") + "\""; }
    public static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    static void write(Path path, String body) throws Exception {
        Files.writeString(path,body,StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW);
        Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rw-------"));
    }
    public static String json(Object o) {
        if(o==null)return "null";
        if(o instanceof Number || o instanceof Boolean)return o.toString();
        if(o instanceof Map<?,?> m){List<String> parts=new ArrayList<>();m.entrySet().stream().sorted(Comparator.comparing(e->e.getKey().toString())).forEach(e->parts.add(json(e.getKey().toString())+":"+json(e.getValue())));return "{"+String.join(",",parts)+"}";}
        if(o instanceof Collection<?> l)return "["+String.join(",",l.stream().map(NativeAgent::json).toList())+"]";
        StringBuilder b=new StringBuilder("\"");for(char c:o.toString().toCharArray()) { if(c=='"'||c=='\\')b.append('\\').append(c);else if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c); }return b.append('"').toString();
    }
}
