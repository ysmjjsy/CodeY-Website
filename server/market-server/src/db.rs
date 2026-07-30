#[cfg(test)]
pub use rusqlite::{
    params, Connection, Error, OptionalExtension, Params, Row, Transaction, TransactionBehavior,
};
#[cfg(test)]
pub type Result<T> = rusqlite::Result<T>;

#[cfg(test)]
pub fn connect(path: impl AsRef<std::path::Path>, _database_url: &str) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    Ok(connection)
}

#[cfg(not(test))]
mod postgres_backend {
    use std::borrow::Cow;
    use std::cell::{RefCell, RefMut};
    use std::error::Error as StdError;
    use std::fmt;
    use std::path::Path;

    use postgres::types::{to_sql_checked, FromSqlOwned, IsNull, ToSql, Type};
    use postgres::{Client, NoTls};
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum DatabaseError {
        #[error(transparent)]
        Postgres(#[from] postgres::Error),
        #[error("query returned no rows")]
        QueryReturnedNoRows,
        #[error("database parameter cannot be represented: {0}")]
        InvalidParameter(String),
    }

    pub type Error = DatabaseError;
    pub type Result<T> = std::result::Result<T, Error>;

    #[derive(Debug, Clone)]
    pub enum Value {
        Null,
        Text(String),
        Integer(i64),
        Bytes(Vec<u8>),
        Float(f64),
        Boolean(bool),
    }

    impl ToSql for Value {
        fn to_sql(
            &self,
            ty: &Type,
            out: &mut bytes::BytesMut,
        ) -> std::result::Result<IsNull, Box<dyn StdError + Send + Sync>> {
            match self {
                Self::Null => Ok(IsNull::Yes),
                Self::Text(value) => value.to_sql(ty, out),
                Self::Integer(value) => value.to_sql(ty, out),
                Self::Bytes(value) => value.to_sql(ty, out),
                Self::Float(value) => value.to_sql(ty, out),
                Self::Boolean(value) => value.to_sql(ty, out),
            }
        }

        fn accepts(_ty: &Type) -> bool {
            true
        }

        to_sql_checked!();
    }

    pub trait DatabaseValue {
        fn database_value(&self) -> Result<Value>;
    }

    impl DatabaseValue for () {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Null)
        }
    }
    impl DatabaseValue for str {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Text(self.to_owned()))
        }
    }
    impl DatabaseValue for String {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Text(self.clone()))
        }
    }
    impl DatabaseValue for i64 {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Integer(*self))
        }
    }
    impl DatabaseValue for i32 {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Integer(i64::from(*self)))
        }
    }
    impl DatabaseValue for u64 {
        fn database_value(&self) -> Result<Value> {
            i64::try_from(*self)
                .map(Value::Integer)
                .map_err(|_| Error::InvalidParameter(self.to_string()))
        }
    }
    impl DatabaseValue for u32 {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Integer(i64::from(*self)))
        }
    }
    impl DatabaseValue for usize {
        fn database_value(&self) -> Result<Value> {
            i64::try_from(*self)
                .map(Value::Integer)
                .map_err(|_| Error::InvalidParameter(self.to_string()))
        }
    }
    impl DatabaseValue for f64 {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Float(*self))
        }
    }
    impl DatabaseValue for bool {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Boolean(*self))
        }
    }
    impl DatabaseValue for Vec<u8> {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Bytes(self.clone()))
        }
    }
    impl DatabaseValue for [u8] {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Bytes(self.to_vec()))
        }
    }
    impl DatabaseValue for Cow<'_, str> {
        fn database_value(&self) -> Result<Value> {
            Ok(Value::Text(self.to_string()))
        }
    }
    impl<T: DatabaseValue + ?Sized> DatabaseValue for &T {
        fn database_value(&self) -> Result<Value> {
            (*self).database_value()
        }
    }
    impl<T: DatabaseValue> DatabaseValue for Option<T> {
        fn database_value(&self) -> Result<Value> {
            self.as_ref()
                .map_or(Ok(Value::Null), DatabaseValue::database_value)
        }
    }

    pub fn value<T: DatabaseValue + ?Sized>(value: &T) -> Result<Value> {
        value.database_value()
    }

    #[derive(Debug, Default)]
    pub struct DatabaseParams(pub Vec<Result<Value>>);

    pub trait Params {
        fn into_values(self) -> Result<Vec<Value>>;
    }

    impl Params for DatabaseParams {
        fn into_values(self) -> Result<Vec<Value>> {
            self.0.into_iter().collect()
        }
    }

    impl<T: DatabaseValue, const N: usize> Params for [T; N] {
        fn into_values(self) -> Result<Vec<Value>> {
            self.iter().map(DatabaseValue::database_value).collect()
        }
    }

    pub struct Connection {
        client: RefCell<Option<Client>>,
    }

    impl fmt::Debug for Connection {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .debug_struct("PostgresConnection")
                .finish_non_exhaustive()
        }
    }

    pub fn connect(_path: impl AsRef<Path>, database_url: &str) -> Result<Connection> {
        let mut client = blocking(|| Client::connect(database_url, NoTls))?;
        blocking(|| client.batch_execute("SET timezone TO 'UTC';"))?;
        Ok(Connection {
            client: RefCell::new(Some(client)),
        })
    }

    impl Connection {
        fn client(&self) -> RefMut<'_, Client> {
            RefMut::map(self.client.borrow_mut(), |client| {
                client.as_mut().expect("PostgreSQL connection is open")
            })
        }

        pub fn execute_batch(&self, sql: &str) -> Result<()> {
            blocking(|| self.client().batch_execute(&normalize_sql(sql)))?;
            Ok(())
        }

        pub fn execute<P: Params>(&self, sql: &str, parameters: P) -> Result<usize> {
            execute(&mut self.client(), sql, parameters)
        }

        pub fn query_row<P, F, T>(&self, sql: &str, parameters: P, mapper: F) -> Result<T>
        where
            P: Params,
            F: FnOnce(&Row) -> Result<T>,
        {
            query_row(&mut self.client(), sql, parameters, mapper)
        }

        pub fn prepare(&self, sql: &str) -> Result<Statement<'_>> {
            Ok(Statement {
                connection: self,
                sql: normalize_sql(sql),
            })
        }

        pub fn transaction_with_behavior(
            &mut self,
            _behavior: TransactionBehavior,
        ) -> Result<Transaction<'_>> {
            blocking(|| {
                self.client()
                    .batch_execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
            })?;
            Ok(Transaction {
                connection: self,
                finished: false,
            })
        }
    }

    impl Drop for Connection {
        fn drop(&mut self) {
            if let Some(client) = self.client.get_mut().take() {
                blocking(|| drop(client));
            }
        }
    }

    #[derive(Debug, Clone, Copy)]
    pub enum TransactionBehavior {
        Immediate,
    }

    pub struct Transaction<'a> {
        connection: &'a Connection,
        finished: bool,
    }

    impl std::ops::Deref for Transaction<'_> {
        type Target = Connection;

        fn deref(&self) -> &Self::Target {
            self.connection
        }
    }

    impl Transaction<'_> {
        pub fn execute<P: Params>(&self, sql: &str, parameters: P) -> Result<usize> {
            self.connection.execute(sql, parameters)
        }

        pub fn query_row<P, F, T>(&self, sql: &str, parameters: P, mapper: F) -> Result<T>
        where
            P: Params,
            F: FnOnce(&Row) -> Result<T>,
        {
            self.connection.query_row(sql, parameters, mapper)
        }

        pub fn prepare(&self, sql: &str) -> Result<Statement<'_>> {
            self.connection.prepare(sql)
        }

        pub fn commit(mut self) -> Result<()> {
            blocking(|| self.connection.client().batch_execute("COMMIT"))?;
            self.finished = true;
            Ok(())
        }
    }

    impl Drop for Transaction<'_> {
        fn drop(&mut self) {
            if !self.finished {
                let _ = blocking(|| self.connection.client().batch_execute("ROLLBACK"));
            }
        }
    }

    pub struct Statement<'a> {
        connection: &'a Connection,
        sql: String,
    }

    impl Statement<'_> {
        pub fn query_map<P, F, T>(
            &mut self,
            parameters: P,
            mut mapper: F,
        ) -> Result<std::vec::IntoIter<Result<T>>>
        where
            P: Params,
            F: FnMut(&Row) -> Result<T>,
        {
            let values = parameters.into_values()?;
            let references = parameter_references(&values);
            let rows = blocking(|| self.connection.client().query(&self.sql, &references))?;
            Ok(rows
                .into_iter()
                .map(|row| mapper(&Row(row, std::marker::PhantomData)))
                .collect::<Vec<_>>()
                .into_iter())
        }
    }

    pub struct Row<'a>(postgres::Row, std::marker::PhantomData<&'a ()>);

    impl Row<'_> {
        pub fn get<I, T>(&self, index: I) -> Result<T>
        where
            I: postgres::row::RowIndex + fmt::Display,
            T: FromSqlOwned,
        {
            self.0.try_get(index).map_err(Error::from)
        }
    }

    pub trait OptionalExtension<T> {
        fn optional(self) -> Result<Option<T>>;
    }

    impl<T> OptionalExtension<T> for Result<T> {
        fn optional(self) -> Result<Option<T>> {
            match self {
                Ok(value) => Ok(Some(value)),
                Err(Error::QueryReturnedNoRows) => Ok(None),
                Err(error) => Err(error),
            }
        }
    }

    fn execute<P: Params>(client: &mut Client, sql: &str, parameters: P) -> Result<usize> {
        let values = parameters.into_values()?;
        let references = parameter_references(&values);
        let affected = blocking(|| client.execute(&normalize_sql(sql), &references))?;
        usize::try_from(affected).map_err(|_| Error::InvalidParameter(affected.to_string()))
    }

    fn query_row<P, F, T>(client: &mut Client, sql: &str, parameters: P, mapper: F) -> Result<T>
    where
        P: Params,
        F: FnOnce(&Row) -> Result<T>,
    {
        let values = parameters.into_values()?;
        let references = parameter_references(&values);
        let row = blocking(|| client.query_opt(&normalize_sql(sql), &references))?
            .ok_or(Error::QueryReturnedNoRows)?;
        mapper(&Row(row, std::marker::PhantomData))
    }

    fn parameter_references(values: &[Value]) -> Vec<&(dyn ToSql + Sync)> {
        values
            .iter()
            .map(|value| value as &(dyn ToSql + Sync))
            .collect()
    }

    fn blocking<T>(operation: impl FnOnce() -> T) -> T {
        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::block_in_place(operation)
        } else {
            operation()
        }
    }

    fn normalize_sql(sql: &str) -> String {
        let mut normalized = String::with_capacity(sql.len());
        let mut characters = sql.chars().peekable();
        while let Some(character) = characters.next() {
            if character == '?' && characters.peek().is_some_and(char::is_ascii_digit) {
                normalized.push('$');
                while characters.peek().is_some_and(char::is_ascii_digit) {
                    normalized.push(characters.next().expect("peeked digit must exist"));
                }
            } else {
                normalized.push(character);
            }
        }
        normalized
            .replace("INTEGER", "BIGINT")
            .replace(" BLOB", " BYTEA")
    }

    #[macro_export]
    macro_rules! database_params {
        () => { $crate::db::DatabaseParams(Vec::new()) };
        ($($parameter:expr),+ $(,)?) => {
            $crate::db::DatabaseParams(vec![$($crate::db::value(&$parameter)),+])
        };
    }

    pub use crate::database_params as params;
}

#[cfg(not(test))]
pub use postgres_backend::*;
